import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { InvalidOutputPlanError } from "../core/output-plan";
import type { ErrorResult } from "../messages";

/**
 * Turn a thrown value into a typed error result for the UI.
 *
 * - Memory exhaustion gets its own reason and an actionable message.
 * - A `WebAssembly.RuntimeError` is a trap (a C++ assertion, an
 *   out-of-bounds access). After a trap the engine's memory is in an
 *   unknown state, so the UI must start a new worker: reason "crashed".
 * - A rejected output plan (a bug in the UI, or a file closed meanwhile)
 *   is an ordinary failure, worded as such.
 * - Anything else is an ordinary failure and the engine stays usable.
 *
 * @param err The thrown value.
 * @param doing What was happening, to finish "ran out of memory while …",
 *   e.g. "building the PDF".
 * @returns An error result.
 */
export function toErrorResult(err: unknown, doing: string): ErrorResult {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message: `The browser ran out of memory while ${doing}. Close other tabs, or try smaller files.`,
    };
  }
  if (
    typeof WebAssembly !== "undefined" &&
    err instanceof WebAssembly.RuntimeError
  ) {
    return {
      status: "error",
      reason: "crashed",
      message: `The PDF engine stopped unexpectedly (${err.message}). It has been restarted; please try again.`,
    };
  }
  if (err instanceof InvalidOutputPlanError) {
    return {
      status: "error",
      reason: "failed",
      message: `Could not build the PDF: ${err.message}`,
    };
  }
  return { status: "error", reason: "failed", message: errorMessage(err) };
}
