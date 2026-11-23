import type { PageBox, PageInfo } from "@/lib/pdfium/page-box";
import type { RedactionMark, RedactionReport } from "./core/model";
import type { OpenResult, RedactProgressStage } from "./messages";

/** Where opening a PDF currently stands in the UI lifecycle. */
export type DocumentStatus =
  | { kind: "empty" }
  | { kind: "opening"; fileName: string }
  | { kind: "needs-password"; fileName: string; wrong: boolean }
  | { kind: "ready"; fileName: string; pages: PageInfo[] }
  | { kind: "failed"; fileName: string; message: string };

/** Actions consumed by {@link documentReducer}. */
export type DocumentAction =
  | { type: "opening"; fileName: string }
  | { type: "opened"; result: OpenResult }
  | { type: "read-failed"; fileName: string; message: string }
  | { type: "reset" };

export const INITIAL_DOCUMENT_STATUS: DocumentStatus = { kind: "empty" };

/**
 * Pure reducer governing document opening, password prompting, and reset.
 *
 * @param state Current document status.
 * @param action Lifecycle transition.
 * @returns Next document status.
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
        case "needs-password":
          return { kind: "needs-password", fileName, wrong: r.wrong };
        case "error":
          return { kind: "failed", fileName, message: r.message };
      }
    }
  }
}

/** Actions consumed by {@link marksReducer}. */
export type MarksAction =
  | { type: "add"; mark: RedactionMark }
  | { type: "add-batch"; marks: readonly RedactionMark[] }
  | { type: "toggle"; id: string }
  | { type: "set-all"; enabled: boolean }
  | { type: "remove"; id: string }
  | { type: "clear" };

/** Check whether two boxes on the same page represent virtually the same region. */
function isDuplicateBox(a: PageBox, b: PageBox): boolean {
  return (
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.bottom - b.bottom) < 1 &&
    Math.abs(a.right - b.right) < 1 &&
    Math.abs(a.top - b.top) < 1
  );
}

/**
 * Pure reducer managing candidate redaction marks and deduplicating repeated
 * search/preset scans over identical bounding boxes.
 *
 * @param marks Current list of marks.
 * @param action Mark mutation action.
 * @returns Updated list of marks.
 */
export function marksReducer(
  marks: readonly RedactionMark[],
  action: MarksAction,
): RedactionMark[] {
  switch (action.type) {
    case "add":
      return [...marks, action.mark];
    case "add-batch": {
      const next = [...marks];
      for (const candidate of action.marks) {
        const exists = next.some(
          (m) =>
            m.pageIndex === candidate.pageIndex &&
            isDuplicateBox(m.box, candidate.box),
        );
        if (!exists) next.push(candidate);
      }
      return next;
    }
    case "toggle":
      return marks.map((m) =>
        m.id === action.id ? { ...m, enabled: !m.enabled } : m,
      );
    case "set-all":
      return marks.map((m) => ({ ...m, enabled: action.enabled }));
    case "remove":
      return marks.filter((m) => m.id !== action.id);
    case "clear":
      return [];
  }
}

/** Current status of the apply + sanitize + verify job. */
export type JobStatus =
  | { kind: "idle" }
  | { kind: "working"; stage: RedactProgressStage; fraction: number }
  | { kind: "done"; data: ArrayBuffer; report: RedactionReport }
  | { kind: "failed"; message: string };

export const IDLE_JOB: JobStatus = { kind: "idle" };

/**
 * Map worker stage + fraction into a unified `0..1` progress bar value.
 *
 * @param job Current job status.
 * @returns Progress fraction in `[0, 1]`.
 */
export function jobProgress(job: JobStatus): number {
  if (job.kind !== "working") return 0;
  switch (job.stage) {
    case "redacting":
      return job.fraction * 0.5;
    case "cleaning":
      return 0.5 + job.fraction * 0.25;
    case "verifying":
      return 0.75 + job.fraction * 0.25;
  }
}
