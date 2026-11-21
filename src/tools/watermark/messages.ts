/** Messages between the watermark UI and its Web Worker. */
import type { WatermarkSettings } from "./core/model";

export type WatermarkRequest =
  /** Open a file (replacing any open one). `data` is transferred. */
  | { op: "open"; data: ArrayBuffer; password?: string }
  /**
   * Render one page `width` pixels wide, as the download will show it:
   * with the watermark when `settings` is given, as it is otherwise.
   */
  | {
      op: "preview";
      pageIndex: number;
      width: number;
      settings?: WatermarkSettings;
    }
  /** Watermark the given 0-based pages and return the whole PDF. */
  | { op: "apply"; settings: WatermarkSettings; pages: number[] }
  /** Close the file and free its memory. */
  | { op: "close" };

/**
 * - "out-of-memory": the browser could not give the engines more memory.
 * - "crashed": a WebAssembly engine trapped; the worker must be replaced
 *   (and the file opened again) before it is used again.
 * - "failed": an ordinary error (invalid settings, a damaged file); the
 *   worker is still usable.
 */
export type FailureReason = "out-of-memory" | "crashed" | "failed";

export interface ErrorResult {
  status: "error";
  reason: FailureReason;
  message: string;
}

export type OpenResult =
  | { status: "opened"; pageCount: number }
  /** The file is encrypted and no password was given. */
  | { status: "password-required" }
  /** A password was given and it is not the right one. */
  | { status: "wrong-password" }
  | ErrorResult;

export type PreviewResult =
  | {
      status: "rendered";
      width: number;
      height: number;
      /** RGBA pixels, rows top to bottom (transferred). */
      pixels: ArrayBuffer;
    }
  | ErrorResult;

export type ApplyResult =
  | {
      status: "watermarked";
      /** The watermarked PDF (transferred). */
      data: ArrayBuffer;
    }
  | ErrorResult;

export type CloseResult = { status: "closed" };

/** The result type for each request `op`. */
export interface ResultFor {
  open: OpenResult;
  preview: PreviewResult;
  apply: ApplyResult;
  close: CloseResult;
}

export type WatermarkResult = ResultFor[keyof ResultFor];
