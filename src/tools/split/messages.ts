/**
 * Messages between the Split PDF UI and its two Web Workers.
 *
 * - The preview worker (PDFium) keeps the opened file and draws page
 *   thumbnails. It is stateful: open, render many times, close.
 * - The assembly worker (qpdf) builds the output files. It is stateless:
 *   each request carries the file, its password and the plan.
 *
 * Every message crosses a thread boundary, so workers re-check what they
 * receive instead of trusting these types.
 */

import type { Size } from "@/lib/pdfium/page-box";
import type { SessionErrorResult } from "@/lib/session-worker";

/**
 * The error shape every worker result shares (see `SessionErrorResult`):
 * "out-of-memory", "crashed" (the worker must be replaced) or "failed".
 */
export type ErrorResult = SessionErrorResult;

/** A page's size as shown (its own /Rotate applied), in points. */
export type PageSize = Size;

export type PreviewRequest =
  /** Open a file (replacing any open one). `data` is transferred. */
  | { op: "open"; data: ArrayBuffer; password?: string }
  /** Draw a page `width` pixels wide. */
  | { op: "render"; pageIndex: number; width: number }
  /** Close the file and free its memory. */
  | { op: "close" };

export type OpenResult =
  | { status: "opened"; pages: PageSize[] }
  /** The file is encrypted and no password was given. */
  | { status: "password-required" }
  /** A password was given and it is not the right one. */
  | { status: "wrong-password" }
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

export type CloseResult = { status: "closed" };

/** The result type for each preview request `op`. */
export interface PreviewResultFor {
  open: OpenResult;
  render: RenderResult;
  close: CloseResult;
}

export type PreviewResult = PreviewResultFor[keyof PreviewResultFor];

export interface AssembleRequest {
  /** The source PDF (transferred). */
  data: ArrayBuffer;
  /** The password the file opened with, or "" for none. */
  password: string;
  /** Pages in the source, as the preview counted them. */
  pageCount: number;
  /** Source page indices (0-based) for each output file, in order. */
  outputs: number[][];
}

/** One built output file. */
export interface AssembledFile {
  /** The PDF (transferred). */
  data: ArrayBuffer;
  /** CRC-32 of `data`, so a ZIP can be built without reading it again. */
  crc32: number;
}

export type AssembleResult =
  | {
      status: "assembled";
      /** One file per requested output, in the same order. */
      files: AssembledFile[];
      /** qpdf's warnings, if it repaired something while copying. */
      warnings?: string;
    }
  | { status: "wrong-password" }
  | ErrorResult;
