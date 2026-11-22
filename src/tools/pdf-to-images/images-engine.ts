import { errorMessage } from "@/lib/errors";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { PageRenderOptions } from "./core/options";
import type {
  ErrorResult,
  ExtractImagesResult,
  ImagesRequest,
  ImagesResult,
  OpenResult,
  RenderPageResult,
} from "./messages";

/** The part of `WorkerClient` the engine needs (lets tests pass a fake). */
export interface ImagesWorkerClient {
  request(
    payload: ImagesRequest,
    options?: RequestOptions,
  ): Promise<ImagesResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here, in the tool's own code, so the bundler can
 * find the worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createImagesWorkerClient(): ImagesWorkerClient {
  return new WorkerClient<ImagesRequest, ImagesResult>(
    () =>
      new Worker(new URL("./worker/pdf-images.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result returned for every request after {@link ImagesEngine.dispose}. */
const DISPOSED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "The tool was closed.",
};

/**
 * Talks to the worker on behalf of the UI, and hides worker crashes.
 *
 * - Requests are chained (`queue`), so a re-open after a crash can never
 *   interleave with a page request that would then hit an empty worker.
 * - A dead worker, a WebAssembly trap or an out-of-memory error leaves the
 *   engine unusable, so the worker is replaced (`restart`). The new worker
 *   has no file open; the engine kept the file's bytes and password
 *   (`source`), marks itself `stale` and re-opens the file before the next
 *   page request. The failed request reports its error; the next one works.
 */
export class ImagesEngine {
  private client: ImagesWorkerClient | null = null;
  private source: { data: ArrayBuffer; password: string } | null = null;
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    private readonly createClient: () => ImagesWorkerClient = createImagesWorkerClient,
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
   * Render one page of the open file to an image file.
   *
   * @param pageIndex Zero-based page index.
   * @param options Format, DPI and quality.
   * @returns The file or an error.
   */
  renderPage(
    pageIndex: number,
    options: PageRenderOptions,
  ): Promise<RenderPageResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "render-page",
        pageIndex,
        options,
      })) as RenderPageResult;
    });
  }

  /**
   * Extract the images of one page of the open file.
   *
   * @param pageIndex Zero-based page index.
   * @param knownKeys Keys of images already extracted from other pages.
   * @returns The page's image entries or an error.
   */
  extractImages(
    pageIndex: number,
    knownKeys: readonly string[],
  ): Promise<ExtractImagesResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "extract-images",
        pageIndex,
        knownKeys: [...knownKeys],
      })) as ExtractImagesResult;
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
   * Run `task` after every earlier task has settled. The chain swallows
   * failures so one never blocks the requests behind it; the caller still
   * gets the task's own outcome.
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
   * means the worker died; a "crashed" or "out-of-memory" result means its
   * engine cannot be trusted. Both replace the worker.
   *
   * @param payload The request.
   * @param transfer Buffers to transfer instead of copy.
   * @returns The worker's result, or a synthetic error.
   */
  private async send(
    payload: ImagesRequest,
    transfer?: Transferable[],
  ): Promise<ImagesResult> {
    if (this.disposed) return DISPOSED;
    this.client ??= this.createClient();
    let result: ImagesResult;
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
   * @returns null when ready (or nothing to re-open), or the error that
   *   prevented re-opening (the kept file is then dropped).
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
