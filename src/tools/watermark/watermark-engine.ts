import { SessionWorker, type SessionWorkerClient } from "@/lib/session-worker";
import { WorkerClient } from "@/lib/worker-client";
import type { WatermarkSettings } from "./core/model";
import type {
  ApplyResult,
  ErrorResult,
  OpenResult,
  PreviewResult,
  WatermarkRequest,
  WatermarkResult,
} from "./messages";

/** The worker client the engine talks through (tests pass a fake). */
export type WatermarkWorkerClient = SessionWorkerClient<
  WatermarkRequest,
  WatermarkResult
>;

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here, in the tool's own code, so the bundler can
 * find the worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createWatermarkWorkerClient(): WatermarkWorkerClient {
  return new WorkerClient<WatermarkRequest, WatermarkResult>(
    () =>
      new Worker(new URL("./worker/watermark.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result of a preview skipped because newer settings replaced it. */
export const PREVIEW_CANCELLED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "The preview was replaced by a newer one.",
};

/**
 * Talks to the watermark worker on behalf of the UI. Ordering, crash
 * recovery and re-opening the file after a crash are handled by the shared
 * {@link SessionWorker}; this class only builds the watermark requests.
 */
export class WatermarkEngine {
  private readonly session: SessionWorker<WatermarkRequest, WatermarkResult>;

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    createClient: () => WatermarkWorkerClient = createWatermarkWorkerClient,
  ) {
    this.session = new SessionWorker<WatermarkRequest, WatermarkResult>(
      createClient,
      {
        openRequest: (data, password) => ({ op: "open", data, password }),
        isOpened: (result) => result.status === "opened",
        disposedMessage: "The watermark tool was closed.",
      },
    );
  }

  /**
   * Open a file. A copy is transferred; the original is kept for
   * re-opening after a crash.
   *
   * @param data The PDF.
   * @param password The user password, or "" for none.
   * @returns The worker's verdict.
   */
  open(data: ArrayBuffer, password = ""): Promise<OpenResult> {
    return this.session.open(data, password) as Promise<OpenResult>;
  }

  /**
   * Render a page as the download will show it.
   *
   * Settings change faster than pages render (dragging a slider), so the
   * caller aborts a preview it no longer needs; one still waiting in the
   * queue is then skipped and {@link PREVIEW_CANCELLED} returned.
   *
   * @param pageIndex 0-based page.
   * @param width Bitmap width in pixels.
   * @param settings The watermark, or `undefined` for the page without one.
   * @param signal Aborted when the preview is no longer needed.
   * @returns The pixels, an error, or {@link PREVIEW_CANCELLED}.
   */
  preview(
    pageIndex: number,
    width: number,
    settings: WatermarkSettings | undefined,
    signal?: AbortSignal,
  ): Promise<PreviewResult> {
    return this.session.request(
      { op: "preview", pageIndex, width, settings },
      { signal, cancelled: PREVIEW_CANCELLED },
    ) as Promise<PreviewResult>;
  }

  /**
   * Produce the watermarked PDF.
   *
   * @param settings The watermark.
   * @param pages 0-based pages to watermark.
   * @returns The new PDF, or an error.
   */
  apply(settings: WatermarkSettings, pages: number[]): Promise<ApplyResult> {
    return this.session.request({
      op: "apply",
      settings,
      pages,
    }) as Promise<ApplyResult>;
  }

  /**
   * Close the file in the worker and forget the kept bytes.
   *
   * @returns Resolves when the worker has closed it.
   */
  close(): Promise<void> {
    return this.session.close({ op: "close" });
  }

  /** Stop the worker for good; later requests resolve with an error. */
  dispose(): void {
    this.session.dispose();
  }
}
