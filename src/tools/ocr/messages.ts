/**
 * Worker message protocol definitions for the OCR PDF tool.
 *
 * Implements Interface Segregation Principle (ISP) by strictly defining the
 * bidirectional messages exchanged between the UI thread and the Web Worker.
 */

import type { OcrOptions, OcrReport } from "./core/model";

/** Requests sent from the main thread to the OCR Web Worker. */
export type OcrRequest =
  | {
      op: "ocr";
      /** Raw PDF, PNG, or JPEG bytes (transferred). */
      data: ArrayBuffer;
      /** Original filename for diagnostics. */
      filename: string;
      /** Selected languages, DPI, and OCR switches. */
      options: OcrOptions;
      /** Optional open password for encrypted PDFs. */
      password?: string;
    }
  | {
      op: "ping";
    };

/** Results returned from the OCR Web Worker to the main thread. */
export type OcrWorkerResult =
  | {
      status: "completed";
      /** Final searchable PDF bytes (transferred). */
      data: ArrayBuffer;
      /** Per-page telemetry and extracted text report. */
      report: OcrReport;
      /** True when the source file was a PNG/JPEG image converted to PDF. */
      wasImageInput: boolean;
    }
  | {
      status: "password-required";
      wrongPassword?: boolean;
    }
  | {
      status: "cancelled";
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "pong";
    };
