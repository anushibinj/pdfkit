import { WorkerClient, type WorkerLike } from "@/lib/worker-client";
import type { PageLayoutOptions } from "./core/options";
import type {
  BuildPdfRequest,
  BuildPdfResult,
  ImagePageInput,
} from "./messages";

/**
 * Dependency Inversion Principle (DIP): main-thread abstraction for building a
 * PDF from images in a background worker. Hooks and components depend on this
 * interface so tests can inject a fast, deterministic fake client.
 */
export interface ImagesToPdfClient {
  /**
   * Build a PDF from the given validated images.
   *
   * @param images Ordered image payloads (their `data` buffers are transferred).
   * @param options Page layout options.
   * @param onProgress Optional progress callback (`0..1`, optional stage label).
   * @returns The worker's {@link BuildPdfResult}.
   */
  build(
    images: ImagePageInput[],
    options: PageLayoutOptions,
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<BuildPdfResult>;

  /** Terminate the underlying worker and reject any in-flight request. */
  terminate(): void;
}

/**
 * Create an {@link ImagesToPdfClient} backed by a {@link WorkerClient}.
 *
 * Each image's `ArrayBuffer` is passed in the `transfer` list so large photo
 * batches move to the worker thread without doubling memory via structured
 * cloning.
 *
 * @param factory Worker factory (defaults to the tool's module Web Worker).
 * @returns A ready-to-use {@link ImagesToPdfClient}.
 */
export function createWorkerImagesToPdfClient(
  factory: () => WorkerLike = () =>
    new Worker(new URL("./worker/images-to-pdf.worker.ts", import.meta.url), {
      type: "module",
    }),
): ImagesToPdfClient {
  const client = new WorkerClient<BuildPdfRequest, BuildPdfResult>(factory);

  return {
    build(images, options, onProgress) {
      const transfer = images.map((img) => img.data);
      return client.request(
        { op: "build", images, options },
        { transfer, onProgress },
      );
    },
    terminate() {
      client.terminate();
    },
  };
}
