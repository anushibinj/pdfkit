import { errorMessage } from "@/lib/errors";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { QuarterTurns } from "@/tools/edit/core/model";
import type { OutputPage } from "./core/output-plan";
import type {
  ErrorResult,
  OpenResult,
  OrganizeRequest,
  OrganizeResult,
  RenderResult,
  SaveResult,
} from "./messages";

/** The part of `WorkerClient` the engine needs (lets tests pass a fake). */
export interface OrganizeWorkerClient {
  request(
    payload: OrganizeRequest,
    options?: RequestOptions,
  ): Promise<OrganizeResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here, in the tool's own code, so the bundler can
 * find the worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createOrganizeWorkerClient(): OrganizeWorkerClient {
  return new WorkerClient<OrganizeRequest, OrganizeResult>(
    () =>
      new Worker(new URL("./worker/organize.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result of a render skipped because its caller aborted it while queued. */
export const CANCELLED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "Rendering was cancelled.",
};

/** Result returned for every request after {@link OrganizeEngine.dispose}. */
const DISPOSED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "The organizer was closed.",
};

/**
 * Talks to the organizer worker on behalf of the UI, and hides worker
 * crashes. It follows the PDF editor's `EditorEngine`, extended from one
 * file to many:
 *
 * 1. Ordering. Requests run one after another (`queue`), so re-opening the
 *    files after a crash can never interleave with a render that would
 *    then hit an empty worker.
 *
 * 2. Crashes. A WebAssembly trap, an out-of-memory error or a dead worker
 *    leaves the engine unusable, so the worker is replaced. The new worker
 *    has no files open, but the engine kept every opened file's bytes and
 *    password (`sources`). It marks itself `stale` and re-opens all of them,
 *    in their original order and under their original ids, before the next
 *    render or save. The board lives in the UI, so nothing the user did is
 *    lost; they see one error for the request that failed.
 */
export class OrganizeEngine {
  private client: OrganizeWorkerClient | null = null;
  /** Opened files by id, in opening order (a Map keeps insertion order). */
  private readonly sources = new Map<
    string,
    { data: ArrayBuffer; password: string }
  >();
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    private readonly createClient: () => OrganizeWorkerClient = createOrganizeWorkerClient,
  ) {}

  /**
   * Open a file under `sourceId`. A copy of `data` is transferred to the
   * worker; the original is kept for re-opening after a crash, but only if
   * the file opened.
   *
   * @param sourceId The UI's id for the file.
   * @param data The PDF file.
   * @param password The user password, or "" for none.
   * @returns The worker's verdict.
   */
  open(
    sourceId: string,
    data: ArrayBuffer,
    password = "",
  ): Promise<OpenResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      const copy = data.slice(0);
      const result = (await this.send(
        { op: "open", sourceId, data: copy, password },
        [copy],
      )) as OpenResult;
      if (result.status === "opened")
        this.sources.set(sourceId, { data, password });
      return result;
    });
  }

  /**
   * Render a page of an open file.
   *
   * A render whose `signal` was aborted while it waited in the queue (the
   * thumbnail scrolled away) is skipped instead of keeping the worker busy.
   *
   * @param sourceId The file.
   * @param pageIndex Page index in that file.
   * @param rotation User quarter turns to add.
   * @param width Requested bitmap width in pixels.
   * @param signal Aborted when the caller no longer needs the result.
   * @returns The pixels, an error, or {@link CANCELLED}.
   */
  render(
    sourceId: string,
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult> {
    return this.enqueue(async () => {
      if (signal?.aborted) return CANCELLED;
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "render",
        sourceId,
        pageIndex,
        rotation,
        width,
      })) as RenderResult;
    });
  }

  /**
   * Build the organized file.
   *
   * @param pages The output pages, in order.
   * @returns The new file or an error.
   */
  save(pages: OutputPage[]): Promise<SaveResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({ op: "save", pages })) as SaveResult;
    });
  }

  /**
   * Close one file, or every file, in the worker and forget the kept bytes.
   *
   * @param sourceId The file to close; omit to close all.
   * @returns Resolves when the worker has closed it.
   */
  close(sourceId?: string): Promise<void> {
    return this.enqueue(async () => {
      if (sourceId === undefined) this.sources.clear();
      else this.sources.delete(sourceId);
      if (this.sources.size === 0) this.stale = false;
      if (this.client) await this.send({ op: "close", sourceId });
    });
  }

  /** Stop the worker for good; later requests resolve with an error. */
  dispose(): void {
    this.disposed = true;
    this.sources.clear();
    this.client?.terminate();
    this.client = null;
  }

  /**
   * Run `task` after every earlier task has settled. The chain always ends
   * in a resolved promise, so one failure never blocks later requests.
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
   * Send one request, creating the worker on first use. A rejected request
   * (dead worker) or a "crashed"/"out-of-memory" result replaces the
   * worker. After `dispose`, nothing is sent and nothing restarts.
   *
   * @param payload The request.
   * @param transfer Buffers to transfer instead of copy.
   * @returns The worker's result, or a synthetic error.
   */
  private async send(
    payload: OrganizeRequest,
    transfer?: Transferable[],
  ): Promise<OrganizeResult> {
    if (this.disposed) return DISPOSED;
    this.client ??= this.createClient();
    let result: OrganizeResult;
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

  /** Replace the worker; files that were open must be re-opened. */
  private restart(): void {
    this.client?.terminate();
    this.client = null;
    if (this.sources.size > 0) this.stale = true;
  }

  /**
   * After a restart, open every kept file again in the new worker.
   *
   * @returns `null` when ready, or an error saying the board's files could
   *   not be re-opened (with the engine's reason). The kept files are then
   *   dropped, so later requests do not retry (and fail) on every
   *   thumbnail; the board's pages report that their file is not open,
   *   and the user can start over.
   */
  private async reopenIfStale(): Promise<ErrorResult | null> {
    if (!this.stale) return null;
    this.stale = false;
    for (const [sourceId, { data, password }] of this.sources) {
      const copy = data.slice(0);
      const result = await this.send(
        { op: "open", sourceId, data: copy, password },
        [copy],
      );
      if (result.status === "opened") continue;
      this.sources.clear();
      // Say what failed: this error is returned to whichever request came
      // next, which may be about another file entirely (opening a new one).
      const detail = result.status === "error" ? ` ${result.message}` : "";
      return {
        status: "error",
        reason: result.status === "error" ? result.reason : "failed",
        message: `The PDF engine restarted and could not reopen the files already on the board.${detail} Start over and add them again.`,
      };
    }
    return null;
  }
}
