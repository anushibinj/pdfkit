import { errorMessage } from "@/lib/errors";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { QuarterTurns } from "./core/model";
import type { SavePlan } from "./core/save-plan";
import type {
  EditorRequest,
  EditorResult,
  ErrorResult,
  OpenResult,
  RenderResult,
  SaveResult,
} from "./messages";

/** The part of `WorkerClient` the engine needs (lets tests pass a fake). */
export interface EditorWorkerClient {
  request(
    payload: EditorRequest,
    options?: RequestOptions,
  ): Promise<EditorResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here, in the tool's own code, so the bundler can
 * find the worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createEditorWorkerClient(): EditorWorkerClient {
  return new WorkerClient<EditorRequest, EditorResult>(
    () =>
      new Worker(new URL("./worker/pdf-edit.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result returned for every request after {@link EditorEngine.dispose}. */
const DISPOSED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "The editor was closed.",
};

/**
 * Talks to the editor worker on behalf of the UI, and hides worker crashes.
 *
 * Two problems it solves:
 *
 * 1. Ordering. Requests are chained one after another (`queue`), so a
 *    re-open after a crash can never interleave with a render that would
 *    then hit an empty worker. The worker handles one request at a time
 *    anyway, so nothing is lost by queueing here.
 *
 * 2. Crashes. A WebAssembly trap, an out-of-memory error or a dead worker
 *    leaves the engine unusable, so the worker is replaced (`restart`). The
 *    new worker has no file open, but the UI's edits live in the UI, and the
 *    engine kept the original bytes and password (`source`). It marks the
 *    session `stale` and silently re-opens the file before the next render
 *    or save. The user sees one error message for the failed request and
 *    can carry on without losing work.
 */
export class EditorEngine {
  private client: EditorWorkerClient | null = null;
  private source: { data: ArrayBuffer; password: string } | null = null;
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    private readonly createClient: () => EditorWorkerClient = createEditorWorkerClient,
  ) {}

  /**
   * Open a file. A copy of `data` is transferred to the worker; the
   * original is kept for re-opening after a crash.
   *
   * @param data The PDF file.
   * @param password The user password, or "" for none.
   * @returns The worker's verdict.
   */
  open(data: ArrayBuffer, password = ""): Promise<OpenResult> {
    return this.enqueue(async () => {
      const copy = data.slice(0);
      const result = (await this.send({ op: "open", data: copy, password }, [
        copy,
      ])) as OpenResult;
      this.source = result.status === "opened" ? { data, password } : null;
      this.stale = false;
      return result;
    });
  }

  /**
   * Render a page of the unedited file.
   *
   * @param pageIndex Source page index.
   * @param rotation User quarter turns to add.
   * @param width Requested bitmap width in pixels.
   * @returns The pixels or an error.
   */
  render(
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
  ): Promise<RenderResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "render",
        pageIndex,
        rotation,
        width,
      })) as RenderResult;
    });
  }

  /**
   * Produce the edited file. Image bytes in the plan are copied (not
   * transferred): the UI keeps them for later saves.
   *
   * @param plan What to change.
   * @returns The new file or an error.
   */
  save(plan: SavePlan): Promise<SaveResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({ op: "save", plan })) as SaveResult;
    });
  }

  /**
   * Close the file in the worker and forget the kept bytes.
   *
   * @returns Resolves when the worker has closed it.
   */
  close(): Promise<void> {
    return this.enqueue(async () => {
      this.source = null;
      this.stale = false;
      if (this.client) await this.send({ op: "close" });
    });
  }

  /** Stop the worker for good; later requests resolve with an error. */
  dispose(): void {
    this.disposed = true;
    this.source = null;
    this.client?.terminate();
    this.client = null;
  }

  /**
   * Run `task` after every earlier task has settled.
   *
   * `queue` always ends in a promise that resolves, even when a task
   * throws, so one failure never blocks the requests behind it. The
   * caller still receives the task's own outcome.
   *
   * @param task The work.
   * @returns The task's promise.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Send one request, creating the worker on first use.
   *
   * A rejected request means the worker itself died (or was terminated);
   * a "crashed" or "out-of-memory" result means it survived but its engine
   * cannot be trusted. Both replace the worker. After `dispose`, nothing is
   * sent and nothing restarts.
   *
   * @param payload The request.
   * @param transfer Buffers to transfer instead of copy.
   * @returns The worker's result, or a synthetic error.
   */
  private async send(
    payload: EditorRequest,
    transfer?: Transferable[],
  ): Promise<EditorResult> {
    if (this.disposed) return DISPOSED;
    this.client ??= this.createClient();
    let result: EditorResult;
    try {
      result = await this.client.request(payload, { transfer });
    } catch (err) {
      if (this.disposed) return DISPOSED;
      this.restart();
      return {
        status: "error",
        reason: "crashed",
        message: `The PDF engine stopped unexpectedly (${errorMessage(err)}). It has been restarted; please try again.`,
      };
    }
    if (result.status === "error" && result.reason !== "failed") this.restart();
    return result;
  }

  /** Replace the worker; a file that was open must be re-opened. */
  private restart(): void {
    this.client?.terminate();
    this.client = null;
    if (this.source) this.stale = true;
  }

  /**
   * After a restart, open the kept file again in the new worker.
   *
   * @returns `null` when ready, or the error that prevented re-opening (the
   *   kept file is then dropped, so the next request does not loop on it).
   */
  private async reopenIfStale(): Promise<ErrorResult | null> {
    if (!this.stale || !this.source) return null;
    this.stale = false;
    const { data, password } = this.source;
    const copy = data.slice(0);
    const result = await this.send({ op: "open", data: copy, password }, [
      copy,
    ]);
    if (result.status === "opened") return null;
    this.source = null;
    return result.status === "error"
      ? result
      : {
          status: "error",
          reason: "failed",
          message: "Could not reopen the PDF. Open it again.",
        };
  }
}
