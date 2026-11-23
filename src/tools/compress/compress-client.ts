/**
 * Client adapter bridging the main UI thread to the Compress PDF Web Worker.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Encapsulates worker message dispatching and buffer transfers.
 * - Interface Segregation: Exposes only `compress`, `renderPreview`, and `terminate`.
 * - Dependency Inversion: Depends on an abstract `CompressRequestSender`.
 */

import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { CompressOptions } from "./core/model";
import type { CompressRequest, CompressWorkerResult } from "./messages";

/** Abstract client contract consumed by {@link useCompressPdf}. */
export interface CompressClient {
  /**
   * Compresses a single PDF file inside the Web Worker.
   *
   * @param data Raw PDF bytes (transferred).
   * @param filename Original file name.
   * @param options Compression options.
   * @param password Optional open password.
   * @param onProgress Optional progress callback.
   * @returns Worker result.
   */
  compress(
    data: ArrayBuffer,
    filename: string,
    options: CompressOptions,
    password?: string,
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<CompressWorkerResult>;

  /**
   * Renders a matched side-by-side preview of page `pageIndex` from original vs compressed PDFs.
   *
   * @param originalData Original PDF bytes (copied/transferred).
   * @param compressedData Compressed PDF bytes (copied/transferred).
   * @param pageIndex Zero-based page index.
   * @param width Target canvas width in device pixels.
   * @param password Optional open password for the original PDF.
   * @returns Worker result containing both RGBA pixel buffers.
   */
  renderPreview(
    originalData: ArrayBuffer,
    compressedData: ArrayBuffer,
    pageIndex: number,
    width: number,
    password?: string,
  ): Promise<CompressWorkerResult>;

  /** Terminates the underlying worker and rejects pending requests. */
  terminate(): void;
}

/** Narrow request sender abstraction enabling unit testing without real Web Workers. */
export interface CompressRequestSender {
  request(
    payload: CompressRequest,
    options?: RequestOptions,
  ): Promise<CompressWorkerResult>;
  terminate(): void;
}

/**
 * Concrete {@link CompressClient} backed by a {@link WorkerClient}.
 */
export class WorkerCompressClient implements CompressClient {
  /**
   * @param sender Worker communication adapter.
   */
  constructor(private readonly sender: CompressRequestSender) {}

  /** @inheritdoc */
  compress(
    data: ArrayBuffer,
    filename: string,
    options: CompressOptions,
    password?: string,
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<CompressWorkerResult> {
    return this.sender.request(
      { op: "compress", data, filename, options, password },
      {
        transfer: [data],
        onProgress: onProgress
          ? (progress, stage) => onProgress(progress, stage)
          : undefined,
      },
    );
  }

  /** @inheritdoc */
  renderPreview(
    originalData: ArrayBuffer,
    compressedData: ArrayBuffer,
    pageIndex: number,
    width: number,
    password?: string,
  ): Promise<CompressWorkerResult> {
    return this.sender.request(
      {
        op: "preview",
        originalData,
        compressedData,
        pageIndex,
        width,
        password,
      },
      { transfer: [originalData, compressedData] },
    );
  }

  /** @inheritdoc */
  terminate(): void {
    this.sender.terminate();
  }
}

/**
 * Factory creating a {@link CompressClient} wired to `worker/pdf-compress.worker.ts`.
 *
 * @returns Fresh {@link CompressClient}.
 */
export function createWorkerCompressClient(): CompressClient {
  return new WorkerCompressClient(
    new WorkerClient<CompressRequest, CompressWorkerResult>(
      () =>
        new Worker(
          new URL("./worker/pdf-compress.worker.ts", import.meta.url),
          { type: "module" },
        ),
    ),
  );
}
