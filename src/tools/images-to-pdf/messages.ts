import type { ImageMime } from "@/lib/image-info";
import type { QuarterTurns } from "@/lib/pdfium/page-box";
import type { PageLayoutOptions } from "./core/options";

/**
 * Wire protocol between the Images to PDF main thread (`ImagesToPdfClient`)
 * and its Web Worker (`images-to-pdf.worker.ts`).
 */

/** One validated image transferred to the worker for embedding. */
export interface ImagePageInput {
  /** Raw PNG or JPEG file bytes (transferred zero-copy when possible). */
  data: ArrayBuffer;
  /** Image format detected from file header bytes. */
  mime: ImageMime;
  /** Natural pixel width (> 0). */
  width: number;
  /** Natural pixel height (> 0). */
  height: number;
  /** Clockwise quarter-turn rotation (0, 1, 2, or 3). */
  rotation: QuarterTurns;
}

/** Request sent from the main thread to build a PDF from the given images. */
export interface BuildPdfRequest {
  op: "build";
  /** Images in final page order (index 0 becomes page 1). */
  images: ImagePageInput[];
  /** Paper size, orientation, margin, and scaling options. */
  options: PageLayoutOptions;
}

/** Why a worker operation failed. */
export type FailureReason = "out-of-memory" | "crashed" | "invalid-image" | "failed";

/** Response returned from the worker after a build request. */
export type BuildPdfResult =
  | {
      status: "done";
      /** The generated PDF bytes (transferred back to the main thread). */
      data: ArrayBuffer;
      /** Total number of pages written to the PDF. */
      pageCount: number;
    }
  | {
      status: "error";
      reason: FailureReason;
      message: string;
      /** Zero-based index of the image that failed, when attributable to one image. */
      imageIndex?: number;
    };
