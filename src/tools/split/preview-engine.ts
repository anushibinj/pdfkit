import { errorMessage } from "@/lib/errors";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type {
  CloseResult,
  ErrorResult,
  OpenResult,
  PreviewRequest,
  PreviewResult,
  RenderResult,
} from "./messages";

/** The part of `WorkerClient` the engine needs (lets tests pass a fake). */
export interface PreviewWorkerClient {
  request(payload: PreviewRequest, options?: RequestOptions): Promise<PreviewResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here, in the tool's own code, so the bundler can
 * find the worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createPreviewWorkerClient(): PreviewWorkerClient {
  return new WorkerClient<PreviewRequest, PreviewResult>(
    () =>
      new Worker(new URL("./worker/preview.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result of a render skipped because its caller aborted it while queued. */
export const CANCELLED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "Drawing was cancelled.",
};

/** Result for every request after {@link PreviewEngine.dispose}. */
const DISPOSED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "The tool was closed.",
};

/**
 * Talks to the preview worker on behalf of the UI, and hides worker
 * crashes. The same approach as the PDF editor's engine:
 *
 * 1. Ordering. Requests run one after another (`queue`), so re-opening
 *    after a crash can never interleave with a render that would then hit
 *    an empty worker.
 * 2. Crashes. A WebAssembly trap, an out-of-memory error or a dead worker
 *    leaves the engine unusable, so the worker is replaced. The engine
 *    kept the file's bytes and password, so it marks the session `stale`
 *    and opens the file again, silently, before the next render. The user
 *    sees one failed thumbnail at most.
 * 3. Scrolling. Thumbnails ask for renders as they come into view; a
 *    render whose thumbnail scrolled away (its signal aborted) while it
 *    waited in the queue is skipped instead of keeping the worker busy.
 */
export class PreviewEngine {
  private client: PreviewWorkerClient | null = null;
  private source: { data: ArrayBuffer; password: string } | null = null;
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    private readonly createClient: () => PreviewWorkerClient = createPreviewWorkerClient,
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
   * Draw a page as a thumbnail.
   *
   * @param pageIndex 0-based page index.
   * @param width Bitmap width in pixels.
   * @param signal Aborted when the thumbnail no longer needs the result.
   * @returns The pixels, an error, or {@link CANCELLED}.
   */
  render(pageIndex: number, width: number, signal?: AbortSignal): Promise<RenderResult> {
    return this.enqueue(async () => {
      if (signal?.aborted) return CANCELLED;
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({ op: "render", pageIndex, width })) as RenderResult;
    });
  }

  /**
   * Close the file in the worker and forget the kept bytes.
   *
   * @returns Resolves when the worker has closed it.
   */
  close(): Promise<CloseResult> {
    return this.enqueue(async () => {
      this.source = null;
      this.stale = false;
      if (!this.client) return { status: "closed" as const };
      await this.send({ op: "close" });
      return { status: "closed" as const };
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
   * Run `task` after every earlier task has settled. `queue` always ends in
   * a resolved promise, so one failure never blocks the requests behind it;
   * the caller still receives the task's own outcome.
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
   * A rejected request means the worker itself died; a "crashed" or
   * "out-of-memory" result means its engine cannot be trusted. Both replace
   * the worker. After `dispose`, nothing is sent and nothing restarts.
   *
   * @param payload The request.
   * @param transfer Buffers to transfer instead of copy.
   * @returns The worker's result, or a synthetic error.
   */
  private async send(
    payload: PreviewRequest,
    transfer?: Transferable[],
  ): Promise<PreviewResult> {
    if (this.disposed) return DISPOSED;
    this.client ??= this.createClient();
    let result: PreviewResult;
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

  /** Replace the worker; a file that was open must be opened again. */
  private restart(): void {
    this.client?.terminate();
    this.client = null;
    if (this.source) this.stale = true;
  }

  /**
   * After a restart, open the kept file again in the new worker.
   *
   * @returns `null` when ready, or the error that prevented re-opening (the
   *   kept file is then dropped, so later requests do not loop on it).
   */
  private async reopenIfStale(): Promise<ErrorResult | null> {
    if (!this.stale || !this.source) return null;
    this.stale = false;
    const { data, password } = this.source;
    const copy = data.slice(0);
    const result = await this.send({ op: "open", data: copy, password }, [copy]);
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
