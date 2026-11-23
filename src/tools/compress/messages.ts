/**
 * Worker message protocol definitions for the Compress PDF tool.
 *
 * Implements Interface Segregation Principle (ISP) by strictly defining the
 * bidirectional messages exchanged between the UI thread and the Web Worker.
 */

import type {
  CompressOptions,
  CompressReport,
  ResolvedPassConfig,
  TargetSizeEvaluation,
} from "./core/model";

/** Requests sent from the main thread to the Compress PDF Web Worker. */
export type CompressRequest =
  | {
      op: "compress";
      /** Raw PDF bytes (transferred). */
      data: ArrayBuffer;
      /** Original filename for diagnostics. */
      filename: string;
      /** Compression preset and tuning options. */
      options: CompressOptions;
      /** Optional open password for encrypted PDFs. */
      password?: string;
    }
  | {
      op: "preview";
      /** Original PDF bytes (copied/transferred). */
      originalData: ArrayBuffer;
      /** Compressed PDF bytes (copied/transferred). */
      compressedData: ArrayBuffer;
      /** Zero-based page index to render side-by-side. */
      pageIndex: number;
      /** Target render width in device pixels. */
      width: number;
      /** Optional open password for the original PDF. */
      password?: string;
    }
  | {
      op: "ping";
    };

/** Results returned from the Compress PDF Web Worker to the main thread. */
export type CompressWorkerResult =
  | {
      status: "compressed";
      /** Final compressed PDF bytes (transferred). */
      data: ArrayBuffer;
      pageCount: number;
      originalBytes: number;
      compressedBytes: number;
      report: CompressReport;
      appliedConfig: ResolvedPassConfig;
      targetEvaluation?: TargetSizeEvaluation;
      warnings?: string;
    }
  | {
      status: "password-required";
      wrongPassword?: boolean;
    }
  | {
      status: "preview-rendered";
      pageIndex: number;
      pageCount: number;
      width: number;
      height: number;
      /** Original page RGBA pixels (transferred). */
      originalPixels: ArrayBuffer;
      /** Compressed page RGBA pixels (transferred). */
      compressedPixels: ArrayBuffer;
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "pong";
    };
