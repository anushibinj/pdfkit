import type { PageInfo } from "@/lib/pdfium/pdfium-document";
import type { CropReport } from "./core/report";
import type { CropProgressStage, OpenResult } from "./messages";

/** Where opening a file stands, from the UI's point of view. */
export type DocumentStatus =
  | { kind: "empty" }
  | { kind: "opening"; fileName: string }
  | { kind: "ready"; fileName: string; pages: PageInfo[] }
  | { kind: "failed"; fileName: string; message: string };

export type DocumentAction =
  | { type: "opening"; fileName: string }
  /** The worker answered the open request. */
  | { type: "opened"; result: OpenResult }
  /** Reading the file itself failed before the worker saw it. */
  | { type: "read-failed"; fileName: string; message: string }
  /** The file was closed. */
  | { type: "reset" };

export const INITIAL_DOCUMENT_STATUS: DocumentStatus = { kind: "empty" };

/**
 * Pure transitions for the document lifecycle. An "opened" answer only
 * counts while a file is being opened; a late answer for a file the user
 * already closed or replaced is ignored.
 *
 * @param state Current status.
 * @param action What happened.
 * @returns The next status.
 */
export function documentReducer(
  state: DocumentStatus,
  action: DocumentAction,
): DocumentStatus {
  switch (action.type) {
    case "opening":
      return { kind: "opening", fileName: action.fileName };
    case "read-failed":
      return {
        kind: "failed",
        fileName: action.fileName,
        message: action.message,
      };
    case "reset":
      return state.kind === "empty" ? state : INITIAL_DOCUMENT_STATUS;
    case "opened": {
      if (state.kind !== "opening") return state;
      const { fileName } = state;
      const r = action.result;
      switch (r.status) {
        case "opened":
          return { kind: "ready", fileName, pages: r.pages };
        case "encrypted":
        case "error":
          return { kind: "failed", fileName, message: r.message };
      }
    }
  }
}

/** Where a crop stands. */
export type JobStatus =
  | { kind: "idle" }
  | { kind: "working"; stage: CropProgressStage; fraction: number }
  | {
      kind: "done";
      /** The cropped PDF. */
      data: ArrayBuffer;
      report: CropReport;
      removeOutside: boolean;
    }
  | { kind: "failed"; message: string };

export const IDLE_JOB: JobStatus = { kind: "idle" };

/**
 * The share of the work done, 0..1, for a progress bar. A crop that
 * removes content spends most of its time checking pages, so cropping is
 * the first fifth and checking the rest; a crop that only hides is all
 * "cropping".
 *
 * @param job The job.
 * @param removeOutside Whether pages are checked afterwards.
 * @returns The fraction done, or 0 when not working.
 */
export function jobProgress(job: JobStatus, removeOutside: boolean): number {
  if (job.kind !== "working") return 0;
  if (!removeOutside) return job.fraction;
  return job.stage === "cropping"
    ? job.fraction * 0.2
    : 0.2 + job.fraction * 0.8;
}
