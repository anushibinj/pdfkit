import { errorMessage, isOutOfMemory } from "@/lib/errors";
import type { QpdfCommands } from "@/lib/qpdf/qpdf-runner";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { UnlockRequest, UnlockResult } from "../messages";
import { unlockPdf } from "./unlock-job";

/**
 * Turn an unexpected exception from a job into an error result.
 *
 * @param err The thrown value.
 * @returns "out-of-memory" with advice when memory ran out, else "failed".
 */
export function toUnlockFailure(
  err: unknown,
): Extract<UnlockResult, { status: "error" }> {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory while processing this file. Try closing other tabs, or use a smaller file.",
    };
  }
  return { status: "error", reason: "failed", message: errorMessage(err) };
}

/**
 * Build the function the unlock worker exposes with `exposeWorker`.
 *
 * Flow for one request:
 * 1. Report a little progress so the UI shows that work has started.
 * 2. Get qpdf. The first request downloads and compiles it, which can fail
 *    (offline, blocked): that is reported as "Could not load the PDF engine".
 * 3. Unlock. Expected outcomes (wrong password, not encrypted) come back as
 *    results. An exception means qpdf crashed or ran out of memory, after
 *    which its WebAssembly state cannot be trusted, so `resetQpdf` makes the
 *    next request load a fresh instance.
 * 4. Transfer the unlocked file's buffer instead of copying it.
 * The returned promise never rejects, so the UI handles a single shape.
 *
 * @param getQpdf Resolves to a ready qpdf (memoised by the caller).
 * @param resetQpdf Drops the memoised qpdf after a crash.
 * @returns The request handler.
 */
export function createUnlockHandler(
  getQpdf: () => Promise<QpdfCommands>,
  resetQpdf: () => void,
): (
  request: UnlockRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<UnlockResult>> {
  return async (request, ctx) => {
    ctx.progress(0.1, "Starting");
    let qpdf: QpdfCommands;
    try {
      qpdf = await getQpdf();
    } catch (err) {
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }
    let result: UnlockResult;
    try {
      result = unlockPdf(qpdf, request);
    } catch (err) {
      resetQpdf();
      result = toUnlockFailure(err);
    }
    const transfer = result.status === "unlocked" ? [result.data] : [];
    return { result, transfer };
  };
}
