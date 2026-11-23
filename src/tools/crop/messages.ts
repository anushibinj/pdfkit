/** Messages between the crop tool's UI and its Web Worker. */
import type { PageInfo } from "@/lib/pdfium/pdfium-document";
import type { CropPlan } from "./core/crop-plan";
import type { CropReport } from "./core/report";

export type CropRequest =
  /** Open a file (replacing any open one). `data` is transferred. */
  | { op: "open"; data: ArrayBuffer }
  /** Render a page as displayed, `width` pixels wide. */
  | { op: "render"; pageIndex: number; width: number }
  /** Crop the open file (it stays open, unchanged, for another try). */
  | { op: "crop"; plan: CropPlan }
  /** Close the file and free its memory. */
  | { op: "close" };

/**
 * - "out-of-memory": the browser could not give the engine more memory.
 * - "crashed": a WebAssembly engine trapped; the worker must be replaced
 *   (and the file opened again) before it is used again.
 * - "failed": an ordinary error; the worker is still usable.
 */
export type FailureReason = "out-of-memory" | "crashed" | "failed";

export interface ErrorResult {
  status: "error";
  reason: FailureReason;
  message: string;
}

export type OpenResult =
  | { status: "opened"; pages: PageInfo[] }
  /** Encrypted files are refused (see `EncryptedPdfError`). */
  | { status: "encrypted"; message: string }
  | ErrorResult;

export type RenderResult =
  | {
      status: "rendered";
      width: number;
      height: number;
      /** RGBA pixels, rows top to bottom (transferred). */
      pixels: ArrayBuffer;
    }
  | ErrorResult;

export type CropResult =
  | {
      status: "cropped";
      /** The cropped PDF (transferred). */
      data: ArrayBuffer;
      report: CropReport;
      /** Whether every cropped page was checked against the original. */
      verified: boolean;
    }
  /**
   * The check found something changed inside the crop area: the result
   * is withheld (see `CropVerificationError`).
   */
  | { status: "check-failed"; pageIndex: number; message: string }
  | ErrorResult;

export type CloseResult = { status: "closed" };

/** The result type for each request `op`. */
export interface ResultFor {
  open: OpenResult;
  render: RenderResult;
  crop: CropResult;
  close: CloseResult;
}

export type CropWorkerResult = ResultFor[keyof ResultFor];

/** Progress stages of a crop, as the worker reports them. */
export type CropProgressStage = "cropping" | "checking";
