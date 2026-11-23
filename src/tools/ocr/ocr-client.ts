/**
 * Client adapter bridging the main UI thread to the OCR PDF Web Worker.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Encapsulates worker message dispatching and buffer transfers.
 * - Interface Segregation: Exposes only `runOcr` and `terminate`.
 * - Dependency Inversion: Depends on an abstract `OcrRequestSender`.
 */

import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { OcrOptions } from "./core/model";
import type { OcrRequest, OcrWorkerResult } from "./messages";

/** Abstract client contract consumed by {@link useOcrPdf}. */
export interface OcrClient {
  /**
   * Runs OCR on a single PDF or image file inside the Web Worker.
   *
   * @param data Raw file bytes (transferred).
   * @param filename Original filename.
   * @param options User OCR options.
   * @param password Optional open password for encrypted PDFs.
   * @param onProgress Optional progress callback.
   * @returns Worker result.
   */
  runOcr(
    data: ArrayBuffer,
    filename: string,
    options: OcrOptions,
    password?: string,
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<OcrWorkerResult>;

  /** Terminates the underlying worker and rejects pending requests. */
  terminate(): void;
}

/** Narrow request sender abstraction enabling unit testing without real Web Workers. */
export interface OcrRequestSender {
  request(
    payload: OcrRequest,
    options?: RequestOptions,
  ): Promise<OcrWorkerResult>;
  terminate(): void;
}

/**
 * Concrete {@link OcrClient} backed by a {@link WorkerClient}.
 */
export class WorkerOcrClient implements OcrClient {
  /**
   * @param sender Worker communication adapter.
   */
  constructor(private readonly sender: OcrRequestSender) {}

  /** @inheritdoc */
  runOcr(
    data: ArrayBuffer,
    filename: string,
    options: OcrOptions,
    password?: string,
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<OcrWorkerResult> {
    return this.sender.request(
      { op: "ocr", data, filename, options, password },
      {
        transfer: [data],
        onProgress: onProgress
          ? (progress, stage) => onProgress(progress, stage)
          : undefined,
      },
    );
  }

  /** @inheritdoc */
  terminate(): void {
    this.sender.terminate();
  }
}

/**
 * Factory creating an {@link OcrClient} wired to `worker/ocr.worker.ts`.
 *
 * @returns Fresh {@link OcrClient}.
 */
export function createWorkerOcrClient(): OcrClient {
  return new WorkerOcrClient(
    new WorkerClient<OcrRequest, OcrWorkerResult>(
      () =>
        new Worker(new URL("./worker/ocr.worker.ts", import.meta.url), {
          type: "module",
        }),
    ),
  );
}
