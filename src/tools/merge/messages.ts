/** Messages between the Merge PDFs UI and its Web Worker. */

/** One input PDF as sent to the worker. */
export interface MergeSource {
  /** PDF bytes (transferred, not copied) */
  data: ArrayBuffer;
  /** The user password of a password-protected file */
  password?: string;
}

/**
 * Why a request failed.
 * - "out-of-memory": the browser could not allocate enough memory.
 * - "failed": anything else (a damaged file, the engine could not load).
 */
export type FailureReason = "out-of-memory" | "failed";

/** Read one file's page count, which also checks it opens (and its password). */
export interface InspectRequest {
  op: "inspect";
  source: MergeSource;
}

/** Combine every page of every source, in the order given. */
export interface MergeRequest {
  op: "merge";
  sources: MergeSource[];
}

export type MergeWorkerRequest = InspectRequest | MergeRequest;

export type InspectResult =
  | { status: "inspected"; pageCount: number }
  /** The file is encrypted with a user password and none was given. */
  | { status: "password-required" }
  | { status: "wrong-password" }
  | { status: "error"; reason: FailureReason; message: string };

export type MergeResult =
  | {
      status: "merged";
      /** The merged PDF (transferred, not copied) */
      data: ArrayBuffer;
      /** Present when qpdf succeeded with warnings (exit code 3) */
      warnings?: string;
    }
  | {
      status: "error";
      reason: FailureReason;
      message: string;
      /** Index into the request's `sources` of the file that failed, if known */
      sourceIndex?: number;
    };

export type MergeWorkerResult = InspectResult | MergeResult;
