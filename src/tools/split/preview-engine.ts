import { SessionWorker } from "@/lib/session-worker";
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

/**
 * Talks to the preview worker on behalf of the UI. Ordering, crash recovery
 * and re-opening the file after a crash are handled by the shared
 * {@link SessionWorker}; this class only builds the preview's requests.
 */
export class PreviewEngine {
  private readonly session: SessionWorker<PreviewRequest, PreviewResult>;

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(createClient: () => PreviewWorkerClient = createPreviewWorkerClient) {
    this.session = new SessionWorker<PreviewRequest, PreviewResult>(createClient, {
      openRequest: (data, password) => ({ op: "open", data, password }),
      isOpened: (result) => result.status === "opened",
      disposedMessage: "The tool was closed.",
    });
  }

  /**
   * Open a file. A copy of `data` is transferred to the worker; the
   * original is kept for re-opening after a crash.
   *
   * @param data The PDF file.
   * @param password The user password, or "" for none.
   * @returns The worker's verdict.
   */
  open(data: ArrayBuffer, password = ""): Promise<OpenResult> {
    return this.session.open(data, password) as Promise<OpenResult>;
  }

  /**
   * Draw a page as a thumbnail.
   *
   * Thumbnails ask for renders as they scroll into view. A render whose
   * thumbnail scrolled away (its signal aborted) while it waited in the
   * queue is skipped and {@link CANCELLED} returned, instead of keeping the
   * worker busy.
   *
   * @param pageIndex 0-based page index.
   * @param width Bitmap width in pixels.
   * @param signal Aborted when the thumbnail no longer needs the result.
   * @returns The pixels, an error, or {@link CANCELLED}.
   */
  render(pageIndex: number, width: number, signal?: AbortSignal): Promise<RenderResult> {
    return this.session.request(
      { op: "render", pageIndex, width },
      { signal, cancelled: CANCELLED },
    ) as Promise<RenderResult>;
  }

  /**
   * Close the file in the worker and forget the kept bytes.
   *
   * @returns Resolves when the worker has closed it.
   */
  async close(): Promise<CloseResult> {
    await this.session.close({ op: "close" });
    return { status: "closed" };
  }

  /** Stop the worker for good; later requests resolve with an error. */
  dispose(): void {
    this.session.dispose();
  }
}
