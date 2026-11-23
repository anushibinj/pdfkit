import { SessionWorker } from "@/lib/session-worker";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { PageRenderOptions } from "./core/options";
import type {
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

/**
 * Talks to the worker on behalf of the UI. Ordering, crash recovery and
 * re-opening the file after a crash are handled by the shared
 * {@link SessionWorker}; this class only builds this tool's requests.
 */
export class ImagesEngine {
  private readonly session: SessionWorker<ImagesRequest, ImagesResult>;

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    createClient: () => ImagesWorkerClient = createImagesWorkerClient,
  ) {
    this.session = new SessionWorker<ImagesRequest, ImagesResult>(
      createClient,
      {
        openRequest: (data, password) => ({ op: "open", data, password }),
        isOpened: (result) => result.status === "opened",
        disposedMessage: "The tool was closed.",
      },
    );
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
    return this.session.request({
      op: "render-page",
      pageIndex,
      options,
    }) as Promise<RenderPageResult>;
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
    return this.session.request({
      op: "extract-images",
      pageIndex,
      knownKeys: [...knownKeys],
    }) as Promise<ExtractImagesResult>;
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
