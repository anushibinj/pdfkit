import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-messages";
import type { QpdfCommands } from "@/lib/qpdf/qpdf-runner";
import { toTransferableBuffer } from "@/lib/transfer";
import type { UnlockRequest, UnlockResult } from "../messages";

/**
 * Unlock one PDF with qpdf: detect its encryption, then decrypt it.
 *
 * Step by step:
 * 1. Without a password, ask qpdf whether one is needed
 *    (`--requires-password`), which answers through its exit code:
 *    - 3 (warnings): encrypted, but it opens without a password. Only an
 *      owner password is set, so the restrictions can simply be removed.
 *    - 0, or "invalid password": a user password is needed. Ask for it.
 *    - 2 with nothing on stderr: the file is not encrypted at all.
 *    - 2 with a message: the file is damaged or not a PDF.
 * 2. Decrypt (`--decrypt`, plus `--password=` when one was given). A missing
 *    output file is treated as failure even with exit code 0 or 3, so a
 *    half-written file is never offered for download.
 * 3. Exit code 3 still produced a usable file; its warnings are kept so the
 *    UI can show them.
 * The job's virtual files are deleted afterwards in every case.
 *
 * @param qpdf Runs qpdf commands.
 * @param request The PDF and, on a retry, the password the user typed.
 * @returns The outcome; expected failures are results, not exceptions.
 * @throws Only for unexpected failures (out of memory, a WebAssembly trap),
 *   after which the qpdf instance must not be reused.
 */
export function unlockPdf(
  qpdf: QpdfCommands,
  { data, password }: UnlockRequest,
): UnlockResult {
  return qpdf.withJob((job) => {
    const input = job.write("in.pdf", new Uint8Array(data));
    const output = job.path("out.pdf");

    let via: "owner" | "password" = "password";
    if (password === undefined) {
      const probe = qpdf.run(["--requires-password", input]);
      if (probe.code === EXIT_WARNINGS) {
        via = "owner";
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

    if (res.code === EXIT_ERROR || !job.exists("out.pdf")) {
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
      // Transfer needs an ArrayBuffer of exactly the file's size.
      data: toTransferableBuffer(job.read("out.pdf")),
      warnings:
        res.code === EXIT_WARNINGS
          ? friendlyQpdfMessage(res.stderr)
          : undefined,
    };
  });
}
