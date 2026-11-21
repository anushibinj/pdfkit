import { errorMessage, isOutOfMemory } from "@/lib/errors";
import type { RetryableOnce } from "@/lib/retryable-once";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type {
  InspectOutcome,
  MergeOutcome,
  PdfSource,
} from "../core/pdf-merger";
import type {
  InspectResult,
  MergeRequest,
  MergeResult,
  MergeWorkerRequest,
  MergeWorkerResult,
} from "../messages";

/** Anything that checks and merges PDFs (the real one is `PdfMerger`). */
export interface Merger {
  inspect(pdf: Uint8Array, password?: string): InspectOutcome;
  merge(sources: readonly PdfSource[]): MergeOutcome;
}

/** An error result, shaped to fit both `InspectResult` and `MergeResult`. */
type ErrorResult = Extract<InspectResult, { status: "error" }> &
  Extract<MergeResult, { status: "error" }>;

/**
 * Translate what checking one file found into the message sent to the UI.
 *
 * @param outcome What the merger returned.
 * @returns The result (it carries no buffers).
 */
export function toInspectResult(outcome: InspectOutcome): InspectResult {
  switch (outcome.kind) {
    case "inspected":
      return { status: "inspected", pageCount: outcome.pageCount };
    case "password-required":
      return { status: "password-required" };
    case "wrong-password":
      return { status: "wrong-password" };
    case "failed":
      return { status: "error", reason: "failed", message: outcome.message };
  }
}

/**
 * Translate a merge outcome into the message sent to the UI.
 *
 * The merged PDF's bytes may be a view into WebAssembly memory, so they are
 * copied into an exactly sized buffer if needed (`toTransferableBuffer`) and
 * that buffer is transferred, not cloned, to the main thread.
 *
 * @param outcome What the merger returned.
 * @returns The result and the buffers to transfer.
 */
export function toMergeResult(
  outcome: MergeOutcome,
): HandlerResult<MergeResult> {
  if (outcome.kind === "failed") {
    return {
      result: {
        status: "error",
        reason: "failed",
        message: outcome.message,
        sourceIndex: outcome.sourceIndex,
      },
    };
  }
  const data = toTransferableBuffer(outcome.pdf);
  return {
    result: { status: "merged", data, warnings: outcome.warnings },
    transfer: [data],
  };
}

/**
 * Describe a crash of the PDF engine (an exception thrown out of qpdf, as
 * opposed to qpdf reporting a problem with a file).
 *
 * @param err The thrown value.
 * @returns An "out-of-memory" error when memory ran out, otherwise "failed".
 */
export function toCrashResult(err: unknown): ErrorResult {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory. Try merging fewer or smaller files, or close other tabs.",
    };
  }
  return {
    status: "error",
    reason: "failed",
    message: `The PDF engine stopped unexpectedly (${errorMessage(err)}). Please try again.`,
  };
}

/**
 * Read the sources of a merge request. The request crossed a thread
 * boundary, so a password that is not a string is treated as none.
 *
 * @param request The merge request.
 * @returns The sources for the merger.
 */
function sourcesOf(request: MergeRequest): PdfSource[] {
  return request.sources.map(({ data, password }) => ({
    bytes: new Uint8Array(data),
    password: typeof password === "string" ? password : undefined,
  }));
}

/**
 * Build the function the merge worker exposes with `exposeWorker`.
 *
 * Flow for one request:
 * 1. Get the merger. The first request loads qpdf, which can fail (offline
 *    before the first visit was cached, blocked download); that is reported
 *    as "Could not load the PDF engine", and the memoised loader retries on
 *    the next request.
 * 2. Dispatch on `op`: "inspect" checks one file, "merge" combines them.
 *    Problems with a file (a wrong password, damage) come back as outcomes.
 * 3. If qpdf throws, its WebAssembly state can no longer be trusted (an
 *    abort leaves the instance half-way through), so the cached merger is
 *    reset and the next request loads a fresh qpdf, which also releases the
 *    old instance's memory.
 * Every failure becomes a typed result: the promise never rejects, so the UI
 * has a single shape to handle.
 *
 * @param merger The memoised merger (and its reset).
 * @returns The request handler.
 */
export function createMergeHandler(
  merger: RetryableOnce<Merger>,
): (
  request: MergeWorkerRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<MergeWorkerResult>> {
  return async (request) => {
    let ready: Merger;
    try {
      ready = await merger.get();
    } catch (err) {
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }
    try {
      if (request.op === "merge") {
        return toMergeResult(ready.merge(sourcesOf(request)));
      }
      const { data, password } = request.source;
      return {
        result: toInspectResult(
          ready.inspect(
            new Uint8Array(data),
            typeof password === "string" ? password : undefined,
          ),
        ),
      };
    } catch (err) {
      merger.reset();
      return { result: toCrashResult(err) };
    }
  };
}
