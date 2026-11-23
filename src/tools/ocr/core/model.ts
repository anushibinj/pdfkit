/**
 * Core domain types for the OCR PDF tool.
 *
 * Follows Interface Segregation Principle (ISP) by defining clean, immutable
 * value types shared across core logic, WebAssembly engines, worker protocol,
 * and React state management.
 */

/** Tesseract language codes bundled self-hosted in `/wasm/`. */
export type OcrLanguageCode =
  | "eng"
  | "hin"
  | "ben"
  | "tam"
  | "tel"
  | "kan"
  | "mal"
  | "mar"
  | "guj"
  | "pan"
  | "ori";

/** Supported render resolutions (DPI) for OCR page rasterization. */
export type OcrDpi = 150 | 200 | 300;

/** User-configurable OCR processing options. */
export interface OcrOptions {
  /** One or more selected OCR languages (e.g. `["eng", "hin"]`). */
  languages: OcrLanguageCode[];
  /** Rasterization DPI used when rendering PDF pages for Tesseract. */
  dpi: OcrDpi;
  /** When `false`, pages that already contain selectable text are skipped. */
  redoExistingText: boolean;
  /** When `true`, applies luminance contrast enhancement to faded scans. */
  enhanceScan: boolean;
}

/** Per-page processing disposition. */
export type OcrPageStatus = "ocr" | "skipped-existing-text";

/** Recognized text and telemetry for a single document page. */
export interface OcrPageResult {
  /** Zero-based page index in the document. */
  pageIndex: number;
  /** Whether OCR ran or existing text was preserved untouched. */
  status: OcrPageStatus;
  /** Plain UTF-8 text for this page (recognized or pre-existing). */
  text: string;
  /** Mean Tesseract confidence (`0..100`), or `null` when skipped. */
  confidence: number | null;
  /** Number of recognized/extracted whitespace-delimited words. */
  wordCount: number;
}

/** Aggregated OCR summary across all pages of a processed document. */
export interface OcrReport {
  /** Total page count of the output PDF. */
  totalPages: number;
  /** Number of pages that received a new invisible OCR text layer. */
  ocrPagesCount: number;
  /** Number of pages skipped because they already contained real text. */
  skippedPagesCount: number;
  /** Mean confidence across OCR-processed pages (`0..100`), or `null` if none. */
  averageConfidence: number | null;
  /** Total word count across all pages. */
  totalWords: number;
  /** Total non-whitespace character count across all pages. */
  totalCharacters: number;
  /** Combined plain text across all pages, separated by page markers. */
  fullText: string;
  /** Per-page breakdown in document order. */
  pages: OcrPageResult[];
}

/** Outcome returned by {@link OcrSession.run}. */
export type OcrOutcome =
  | {
      kind: "completed";
      /** Searchable PDF bytes (pixel-identical to original PDF pages). */
      pdf: Uint8Array;
      /** Aggregated recognition report and extracted text. */
      report: OcrReport;
      /** True when the input was an image converted into a 1-page PDF. */
      wasImageInput: boolean;
    }
  | {
      kind: "password-required";
      wrongPassword: boolean;
    }
  | {
      kind: "cancelled";
    }
  | {
      kind: "failed";
      message: string;
    };
