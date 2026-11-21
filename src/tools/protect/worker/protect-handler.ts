import { errorMessage, isOutOfMemory } from "@/lib/errors";
import type { RetryableOnce } from "@/lib/retryable-once";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { ProtectOutcome } from "../core/pdf-protector";
import type { ProtectRequest, ProtectResult } from "../messages";

/** Anything that protects a PDF (the real one is `PdfProtector`). */
export interface Protector {
  protect(pdf: Uint8Array, password: string): ProtectOutcome;
}

type ErrorResult = Extract<ProtectResult, { status: "error" }>;

/**
 * Translate a protector's outcome into the message sent to the UI.
 *
 * A protected PDF's bytes may be a view into WebAssembly memory, so they are
 * copied into an exactly sized buffer if needed (`toTransferableBuffer`) and
 * that buffer is transferred, not cloned, to the main thread.
 *
 * @param outcome What the protector returned.
 * @returns The result and the buffers to transfer.
 */
export function toProtectResult(
  outcome: ProtectOutcome,
): HandlerResult<ProtectResult> {
  switch (outcome.kind) {
    case "protected": {
      const data = toTransferableBuffer(outcome.pdf);
      return {
        result: {
          status: "protected",
          data,
          replacedRestrictions: outcome.replacedRestrictions,
          invalidatedSignatures: outcome.invalidatedSignatures,
          warnings: outcome.warnings,
        },
        transfer: [data],
      };
    }
    case "already-protected":
      return { result: { status: "already-protected" } };
    case "failed":
      return {
        result: { status: "error", reason: "failed", message: outcome.message },
      };
  }
}

/**
 * Describe a crash of the PDF engine (an exception thrown out of qpdf, as
 * opposed to qpdf reporting a problem with the file).
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
        "The browser ran out of memory while protecting this file. Try closing other tabs, or use a smaller file.",
    };
  }
  return {
    status: "error",
    reason: "failed",
    message: `The PDF engine stopped unexpectedly (${errorMessage(err)}). Please try again.`,
  };
}

/**
 * Build the function the worker exposes with `exposeWorker`.
 *
 * Flow for one request:
 * 1. Report a little progress so the UI shows that work has started.
 * 2. Get the protector. The first request loads qpdf, which can fail
 *    (offline before the first visit was cached, blocked download); that is
 *    reported as "Could not load the PDF engine", and the memoised loader
 *    retries on the next request.
 * 3. Protect. If qpdf throws, its WebAssembly state can no longer be
 *    trusted (an abort leaves the instance half-way through), so the cached
 *    protector is reset and the next request loads a fresh qpdf.
 * Every failure becomes a typed result: the promise never rejects, so the UI
 * has a single shape to handle.
 *
 * @param protector The memoised protector (and its reset).
 * @returns The request handler.
 */
export function createProtectHandler(
  protector: RetryableOnce<Protector>,
): (
  request: ProtectRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<ProtectResult>> {
  return async (request, ctx) => {
    ctx.progress(0.1, "Loading the PDF engine");
    let ready: Protector;
    try {
      ready = await protector.get();
    } catch (err) {
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }
    ctx.progress(0.3, "Encrypting");
    try {
      // The request crossed a thread boundary: never trust its types.
      const password =
        typeof request.password === "string" ? request.password : "";
      return toProtectResult(
        ready.protect(new Uint8Array(request.data), password),
      );
    } catch (err) {
      protector.reset();
      return { result: toCrashResult(err) };
    }
  };
}
