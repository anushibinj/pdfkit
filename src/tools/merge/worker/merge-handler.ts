import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { PdfMerger } from "../core/pdf-merger";
import type {
  InspectRequest,
  InspectResult,
  MergeRequest,
  MergeResult,
  MergeWorkerRequest,
  MergeWorkerResult,
} from "../messages";

/** An error result, shaped to fit both `InspectResult` and `MergeResult`. */
type Failure = Extract<InspectResult, { status: "error" }> &
  Extract<MergeResult, { status: "error" }>;

/**
 * Turn an unexpected exception into an error result.
 *
 * @param err The thrown value.
 * @returns "out-of-memory" with advice when memory ran out, else "failed".
 */
export function toFailure(err: unknown): Failure {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory. Try merging fewer or smaller files, or close other tabs.",
    };
  }
  return { status: "error", reason: "failed", message: errorMessage(err) };
}

/**
 * Check one file.
 *
 * @param merger The engine.
 * @param request The file to check.
 * @returns The handler result (nothing to transfer back).
 */
function inspect(
  merger: PdfMerger,
  { source }: InspectRequest,
): HandlerResult<InspectResult> {
  return {
    result: merger.inspect({
      bytes: new Uint8Array(source.data),
      password: source.password,
    }),
  };
}

/**
 * Merge the files and transfer the result's buffer back without copying it.
 *
 * @param merger The engine.
 * @param request The files, in output order.
 * @returns The handler result.
 */
function merge(
  merger: PdfMerger,
  { sources }: MergeRequest,
): HandlerResult<MergeResult> {
  const outcome = merger.merge(
    sources.map((s) => ({
      bytes: new Uint8Array(s.data),
      password: s.password,
    })),
  );
  if (outcome.status === "failed") {
    return {
      result: {
        status: "error",
        reason: "failed",
        message: outcome.message,
        sourceIndex: outcome.sourceIndex,
      },
    };
  }
  const data = toTransferableBuffer(outcome.bytes);
  return {
    result: { status: "merged", data, warnings: outcome.warnings },
    transfer: [data],
  };
}

/**
 * Build the function the merge worker exposes with `exposeWorker`.
 *
 * Flow for one request:
 * 1. Get the engine. The first request downloads and compiles qpdf, which
 *    can fail (offline, blocked); that is reported as "Could not load the
 *    PDF engine" instead of a raw error.
 * 2. Dispatch on `op`: "inspect" checks one file, "merge" combines them.
 *    Expected problems (a wrong password, a damaged file) come back as
 *    results from the engine.
 * 3. An exception means the engine crashed or ran out of memory. Its
 *    WebAssembly state can no longer be trusted, so `resetMerger` makes the
 *    next request load a fresh instance (which also frees the old memory).
 * The returned promise never rejects, so the UI handles one shape.
 *
 * @param getMerger Resolves to a ready engine (memoised by the caller).
 * @param resetMerger Drops the memoised engine after a crash.
 * @returns The request handler.
 */
export function createMergeHandler(
  getMerger: () => Promise<PdfMerger>,
  resetMerger: () => void,
): (
  request: MergeWorkerRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<MergeWorkerResult>> {
  return async (request) => {
    let merger: PdfMerger;
    try {
      merger = await getMerger();
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
      return request.op === "inspect"
        ? inspect(merger, request)
        : merge(merger, request);
    } catch (err) {
      resetMerger();
      return { result: toFailure(err) };
    }
  };
}
