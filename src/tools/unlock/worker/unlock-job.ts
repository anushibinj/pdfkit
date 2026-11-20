import { errorMessage, isOutOfMemory } from "@/lib/errors";
import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-output";
import type { QpdfEngine } from "@/lib/qpdf/qpdf-runner";
import type { RetryableOnce } from "@/lib/retryable-once";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { UnlockRequest, UnlockResult } from "../messages";

/**
 * Unlock one PDF with qpdf.
 *
 * Without a password, the file's state is probed first with
 * `qpdf --requires-password`, whose exit code means:
 * - 0: encrypted and a password is needed -> ask for it;
 * - 3 (warnings): encrypted, but it opens without a password (only an owner
 *   password restricts printing, copying...) -> decrypt right away;
 * - 2 with no message: not encrypted -> nothing to do;
 * - 2 with a message: qpdf could not read the file -> explain why.
 * qpdf may also answer "invalid password" instead of exit code 0.
 *
 * Then `qpdf --decrypt [--password=...] in out` writes the unlocked copy. A
 * failure there with "invalid password" means the given password is wrong.
 * Exit code 3 still produced a file; its warnings are passed on.
 *
 * All files live in qpdf's memory file system and are deleted afterwards
 * (`withJob`), also when an exception escapes.
 *
 * @param qpdf A ready qpdf instance.
 * @param request The PDF bytes and, if known, the user password.
 * @returns What happened.
 * @throws When qpdf itself fails (out of memory, a crash); the caller then
 *   discards the instance.
 */
export function unlockPdf(
  qpdf: QpdfEngine,
  { data, password }: UnlockRequest,
): UnlockResult {
  return qpdf.withJob((job) => {
    const input = job.path("in.pdf");
    const output = job.path("out.pdf");
    qpdf.writeFile(input, new Uint8Array(data));

    let via: "owner" | "password" = "password";
    if (password === undefined) {
      const probe = qpdf.run(["--requires-password", input]);
      if (probe.code === EXIT_WARNINGS) {
        via = "owner"; // encrypted, but opens without a password
      } else if (probe.code === EXIT_OK || isInvalidPassword(probe.stderr)) {
        return { status: "password-required" };
      } else if (probe.stderr.trim() === "") {
        return { status: "not-encrypted" };
      } else {
        return {
          status: "error",
          reason: "failed",
          message: friendlyQpdfMessage(probe.stderr),
        };
      }
    }

    const args = ["--decrypt"];
    if (password !== undefined) args.push(`--password=${password}`);
    const res = qpdf.run([...args, input, output]);

    if (res.code === EXIT_ERROR || !qpdf.exists(output)) {
      if (isInvalidPassword(res.stderr)) return { status: "wrong-password" };
      return {
        status: "error",
        reason: "failed",
        message: friendlyQpdfMessage(res.stderr),
      };
    }

    return {
      status: "unlocked",
      via,
      data: toTransferableBuffer(qpdf.readFile(output)),
      warnings:
        res.code === EXIT_WARNINGS
          ? friendlyQpdfMessage(res.stderr)
          : undefined,
    };
  });
}

/**
 * Turn an exception thrown while unlocking into a result.
 *
 * @param err The thrown value.
 * @returns "out-of-memory" with advice when memory ran out, otherwise
 *   "failed" with the error's message.
 */
export function toUnlockError(
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
 * 1. Report that work started.
 * 2. Get qpdf. The first request downloads and compiles it, which can fail
 *    (offline, blocked); that is reported as "Could not load the PDF
 *    engine" and retried on the next request.
 * 3. Unlock. If qpdf throws, its WebAssembly instance cannot be trusted any
 *    more, so it is discarded (`reset`) and the next request starts a fresh
 *    one.
 * Every outcome is a result, so the promise never rejects. The output
 * buffer is transferred, not copied.
 *
 * @param qpdf The memoised qpdf instance.
 * @returns The request handler.
 */
export function createUnlockHandler(
  qpdf: RetryableOnce<QpdfEngine>,
): (
  request: UnlockRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<UnlockResult>> {
  return async (request, ctx) => {
    ctx.progress(0.1, "Starting");
    let engine: QpdfEngine;
    try {
      engine = await qpdf.get();
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
      result = unlockPdf(engine, request);
    } catch (err) {
      qpdf.reset();
      result = toUnlockError(err);
    }
    return {
      result,
      transfer: result.status === "unlocked" ? [result.data] : [],
    };
  };
}
