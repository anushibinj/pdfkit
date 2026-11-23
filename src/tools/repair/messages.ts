/**
 * Worker message protocol definitions for the PDF Repair tool.
 *
 * Implements Interface Segregation Principle (ISP) by strictly defining the
 * bidirectional contract between main thread UI and background Web Worker.
 */

import type { RepairReport } from "./core/model";

/** Requests sent from the main thread to the PDF repair worker. */
export type RepairRequest =
  | {
      op: "repair";
      /** Raw file bytes to repair (transferred to avoid copy overhead). */
      data: ArrayBuffer;
      /** Name of the file being repaired. */
      filename: string;
      /** Optional password if document is encrypted. */
      password?: string;
    }
  | {
      op: "ping";
    };

/** Results sent from the PDF repair worker back to the main thread. */
export type RepairWorkerResult =
  | {
      status: "repaired";
      /** The recovered, valid PDF file bytes (transferred). */
      data: ArrayBuffer;
      /** Number of salvageable and renderable pages. */
      pageCount: number;
      /** Detailed breakdown of structural repairs executed. */
      report: RepairReport;
      /** Non-fatal warnings. */
      warnings?: string;
    }
  | {
      status: "password-required";
    }
  | {
      status: "unrecoverable";
      /** Detailed explanation why the file cannot be recovered. */
      reason: string;
    }
  | {
      status: "error";
      /** Error message if an unhandled exception occurred in the worker. */
      message: string;
    }
  | {
      status: "pong";
    };
