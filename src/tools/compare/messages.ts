/**
 * Typed message protocol shared between the Compare PDFs Web Worker and the
 * main-thread {@link CompareEngine}.
 */
import type { SessionErrorResult } from "@/lib/session-worker";
import type {
  CompareSummary,
  DocSide,
  VisualDiffSummary,
} from "./core/model";

/** Shared error shape returned for worker failures. */
export type CompareErrorResult = SessionErrorResult;

/** Requests sent from the main thread to `compare.worker.ts`. */
export type CompareRequest =
  | {
      op: "open";
      side: DocSide;
      fileName: string;
      data: ArrayBuffer;
      password: string;
    }
  | {
      op: "render";
      side: DocSide;
      pageIndex: number;
      width: number;
    }
  | {
      op: "visual-diff";
      pairIndex: number;
      width: number;
      threshold?: number;
    }
  | { op: "build-report" }
  | { op: "close-side"; side: DocSide }
  | { op: "close-all" };

/** Outcome of opening one side's PDF. */
export type OpenSideResult =
  | {
      status: "opened";
      side: DocSide;
      pageCount: number;
      scannedPages: number;
      summary: CompareSummary | null;
    }
  | { status: "needs-password"; side: DocSide; wrong: boolean }
  | CompareErrorResult;

/** Outcome of rendering a single page. */
export type RenderPageResult =
  | {
      status: "rendered";
      width: number;
      height: number;
      pixels: ArrayBuffer;
    }
  | CompareErrorResult;

/** Outcome of computing a per-pixel visual diff for one page pair. */
export type VisualDiffResult =
  | {
      status: "visual-diff";
      pixels: ArrayBuffer;
      summary: VisualDiffSummary;
    }
  | CompareErrorResult;

/** Outcome of building the annotated Comparison Report PDF. */
export type BuildReportResult =
  | {
      status: "report";
      data: ArrayBuffer;
    }
  | CompareErrorResult;

/** Outcome of closing a side or the entire session. */
export type CloseResult = { status: "closed" } | CompareErrorResult;

/** Union of all responses the Compare worker can emit. */
export type CompareWorkerResult =
  | OpenSideResult
  | RenderPageResult
  | VisualDiffResult
  | BuildReportResult
  | CloseResult;
