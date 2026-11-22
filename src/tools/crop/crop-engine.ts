import { errorMessage } from "@/lib/errors";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { CropPlan } from "./core/crop-plan";
import type {
  CropProgressStage,
  CropRequest,
  CropResult,
  CropWorkerResult,
  ErrorResult,
  OpenResult,
  RenderResult,
} from "./messages";

/** The part of `WorkerClient` the engine needs (lets tests pass a fake). */
export interface CropWorkerClient {
  request(
    payload: CropRequest,
    options?: RequestOptions,
  ): Promise<CropWorkerResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here, in the tool's own code, so the bundler can
 * find the worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createCropWorkerClient(): CropWorkerClient {
  return new WorkerClient<CropRequest, CropWorkerResult>(
    () =>
      new Worker(new URL("./worker/pdf-crop.worker.ts", import.meta.url), {
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

/** Result returned for every request after {@link CropEngine.dispose}. */
const DISPOSED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "The cropper was closed.",
};

/**
 * Talks to the crop worker on behalf of the UI, and hides worker crashes.
 *
 * - Requests run one after another (`queue`), so a re-open after a crash
 *   can never interleave with a render that would then find no file.
 * - A WebAssembly trap, an out-of-memory error or a dead worker leaves the
 *   engine unusable, so the worker is replaced. The engine kept the
 *   original bytes, marks the session `stale`, and opens the file again
 *   before the next request, so the user only sees one error.
 */
export class CropEngine {
  private client: CropWorkerClient | null = null;
  private source: ArrayBuffer | null = null;
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    private readonly createClient: () => CropWorkerClient = createCropWorkerClient,
  ) {}

  /**
   * Open a file. A copy is transferred to the worker; the original is kept
   * for re-opening after a crash.
   *
   * @param data The PDF file.
   * @returns The worker's verdict.
   */
  open(data: ArrayBuffer): Promise<OpenResult> {
    return this.enqueue(async () => {
      const copy = data.slice(0);
      const result = (await this.send({ op: "open", data: copy }, [
        copy,
      ])) as OpenResult;
      this.source = result.status === "opened" ? data : null;
      this.stale = false;
      return result;
    });
  }

  /**
   * Render a page. A render whose `signal` was aborted while it waited in
   * the queue (the page scrolled away, another page was chosen) is skipped.
   *
   * @param pageIndex 0-based page.
   * @param width Requested bitmap width in pixels.
   * @param signal Aborted when the caller no longer needs the result.
   * @returns The pixels, an error, or {@link CANCELLED}.
   */
  render(
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult> {
    return this.enqueue(async () => {
      if (signal?.aborted) return CANCELLED;
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "render",
        pageIndex,
        width,
      })) as RenderResult;
    });
  }

  /**
   * Crop the open file. The file stays open and unchanged, so the user can
   * crop again with other settings.
   *
   * @param plan What to crop.
   * @param onProgress Told the stage and its fraction done.
   * @returns The cropped file, a failed check, or an error.
   */
  crop(
    plan: CropPlan,
    onProgress?: (stage: CropProgressStage, fraction: number) => void,
  ): Promise<CropResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({ op: "crop", plan }, undefined, (p, stage) =>
        onProgress?.(stage === "checking" ? "checking" : "cropping", p),
      )) as CropResult;
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
   * Run `task` after every earlier task has settled. `queue` always ends in
   * a resolved promise, so one failure never blocks the requests behind it.
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
   * @param onProgress Progress messages of this request.
   * @returns The worker's result, or a synthetic error.
   */
  private async send(
    payload: CropRequest,
    transfer?: Transferable[],
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<CropWorkerResult> {
    if (this.disposed) return DISPOSED;
    this.client ??= this.createClient();
    let result: CropWorkerResult;
    try {
      result = await this.client.request(payload, { transfer, onProgress });
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
    const copy = this.source.slice(0);
    const result = await this.send({ op: "open", data: copy }, [copy]);
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
