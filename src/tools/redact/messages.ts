import type { PageBox, PageInfo } from "@/lib/pdfium/page-box";
import type {
  PresetId,
  RedactionMark,
  RedactionPlan,
  RedactionReport,
  VerificationReport,
} from "./core/model";

/** Search specification sent from the UI to the worker. */
export type SearchQuery =
  | { mode: "text"; query: string; caseSensitive: boolean }
  | { mode: "regex"; pattern: string; caseSensitive: boolean }
  | { mode: "presets"; presets: PresetId[] };

/** Requests processed by the Redact PDF Web Worker. */
export type RedactRequest =
  | { op: "open"; data: ArrayBuffer; password: string }
  | { op: "render"; pageIndex: number; width: number }
  | { op: "text-under-box"; pageIndex: number; box: PageBox }
  | { op: "search"; query: SearchQuery }
  | { op: "apply"; plan: RedactionPlan }
  | { op: "close" };

/** Progress stage identifier emitted during `apply`. */
export type RedactProgressStage = "redacting" | "cleaning" | "verifying";

/** Structured error result returned by the Redact PDF worker. */
export interface RedactErrorResult {
  status: "error";
  reason: "failed" | "out-of-memory" | "crashed";
  message: string;
}

/** Result of opening a PDF in the worker. */
export type OpenResult =
  | { status: "opened"; pages: PageInfo[] }
  | { status: "needs-password"; wrong: boolean }
  | RedactErrorResult;

/** Result of rendering one page preview. */
export type RenderResult =
  | { status: "rendered"; width: number; height: number; pixels: ArrayBuffer }
  | RedactErrorResult;

/** Result of extracting text under a manually drawn redaction box. */
export type TextUnderBoxResult =
  | { status: "text-extracted"; text: string }
  | RedactErrorResult;

/** Result of running a search or preset scan across the PDF. */
export type SearchResult =
  | { status: "searched"; matches: Omit<RedactionMark, "id">[] }
  | RedactErrorResult;

/** Result of executing permanent redactions + verification. */
export type ApplyResult =
  | { status: "redacted"; data: ArrayBuffer; report: RedactionReport }
  | {
      status: "verification-failed";
      verification: VerificationReport;
      message: string;
    }
  | RedactErrorResult;

/** Union of all responses returned by the Redact PDF worker. */
export type RedactWorkerResult =
  | OpenResult
  | RenderResult
  | TextUnderBoxResult
  | SearchResult
  | ApplyResult
  | { status: "closed" };
