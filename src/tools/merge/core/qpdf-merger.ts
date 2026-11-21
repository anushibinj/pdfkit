import {
  EXIT_ERROR,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-messages";
import type { QpdfCommands, QpdfRunResult } from "@/lib/qpdf/qpdf-runner";
import type { InspectResult } from "../messages";
import { mergeArgs, pageCountArgs } from "./merge-args";
import type { MergeOutcome, PdfMerger, PdfSource } from "./pdf-merger";

/**
 * Read the outcome of a `--show-npages` run.
 *
 * Decision order, and why:
 * 1. Exit code 2 (error): "invalid password" means a password is missing, or
 *    wrong if one was given (qpdf prints the same text for both). Any other
 *    error means the file is damaged or not a PDF.
 * 2. Exit code 0 or 3 (3 = warnings, e.g. a repaired cross-reference table):
 *    the count is the last stdout line. A file whose count is missing is
 *    reported as unreadable rather than guessed at.
 * 3. Zero pages is refused: there is nothing of it to merge, and qpdf's
 *    page range "1-z" would fail on it at merge time.
 *
 * @param res The run's exit code and output.
 * @param passwordGiven Whether a password was passed.
 * @returns The inspection result.
 */
export function interpretPageCount(
  res: QpdfRunResult,
  passwordGiven: boolean,
): InspectResult {
  if (res.code === EXIT_ERROR) {
    if (isInvalidPassword(res.stderr)) {
      return passwordGiven
        ? { status: "wrong-password" }
        : { status: "password-required" };
    }
    return {
      status: "error",
      reason: "failed",
      message: friendlyQpdfMessage(res.stderr),
    };
  }
  const lastLine = res.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!/^\d+$/.test(lastLine)) {
    return {
      status: "error",
      reason: "failed",
      message: "Could not count the pages of this PDF.",
    };
  }
  const pageCount = Number(lastLine);
  if (pageCount === 0) {
    return {
      status: "error",
      reason: "failed",
      message: "This PDF has no pages.",
    };
  }
  return { status: "inspected", pageCount };
}

/**
 * Work out which input a failed merge choked on, and say why.
 *
 * qpdf names the file in each stderr line ("qpdf: /job-2-in-1.pdf: can't
 * find startxref"). It stops at the first fatal error, which is printed
 * last, but warnings about *earlier* files may come before it. So:
 * 1. Walk the lines from the end and take the first input path found: that
 *    is the file the fatal error is about. Paths end in ".pdf", so
 *    "/job-2-in-1.pdf" can never match inside "/job-2-in-10.pdf".
 * 2. Build the message only from the lines about that file, so a harmless
 *    warning about another file is not blamed on it. Without a match (a
 *    message about the output, say), every line is used.
 * 3. A wrong password gets a plain sentence.
 *
 * @param stderr Everything qpdf wrote to stderr.
 * @param inputPaths The inputs' virtual paths, in source order.
 * @returns The message and, when known, the failing source's index.
 */
export function describeMergeFailure(
  stderr: string,
  inputPaths: readonly string[],
): { message: string; sourceIndex?: number } {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let sourceIndex: number | undefined;
  for (let i = lines.length - 1; i >= 0 && sourceIndex === undefined; i--) {
    const found = inputPaths.findIndex((path) => lines[i].includes(path));
    if (found >= 0) sourceIndex = found;
  }
  const relevant =
    sourceIndex === undefined
      ? lines
      : lines.filter((l) => l.includes(inputPaths[sourceIndex]));
  const text = relevant.join("\n");
  const message = isInvalidPassword(text)
    ? "The password for this file is wrong."
    : friendlyQpdfMessage(text);
  return sourceIndex === undefined ? { message } : { message, sourceIndex };
}

/**
 * {@link PdfMerger} backed by qpdf (the command line compiled to
 * WebAssembly). qpdf copies pages as PDF objects: page content is never
 * re-rendered or re-compressed, so text stays text and nothing loses quality.
 */
export class QpdfMerger implements PdfMerger {
  /** @param qpdf Runs qpdf commands (the real one loads the WebAssembly build). */
  constructor(private readonly qpdf: QpdfCommands) {}

  /**
   * Count a file's pages with `--show-npages`. The file is written to its
   * own job, so it is deleted again whatever happens.
   *
   * @inheritdoc
   */
  inspect({ bytes, password }: PdfSource): InspectResult {
    return this.qpdf.withJob((job) => {
      const path = job.write("in.pdf", bytes);
      const res = this.qpdf.run(pageCountArgs({ path, password }));
      return interpretPageCount(res, Boolean(password));
    });
  }

  /**
   * Merge with `--empty --pages ...` (see `mergeArgs`).
   *
   * Every source gets its own virtual file ("in-0.pdf", "in-1.pdf", ...),
   * even when two sources are the same file, so each keeps its own
   * password. As with unlocking, a missing output file counts as failure
   * whatever the exit code, so a half-written file is never returned. The
   * job deletes every input and the output afterwards; the result is a copy
   * read out of the virtual file system before that happens.
   *
   * @inheritdoc
   */
  merge(sources: readonly PdfSource[]): MergeOutcome {
    return this.qpdf.withJob((job) => {
      const inputs = sources.map(({ bytes, password }, i) => ({
        path: job.write(`in-${i}.pdf`, bytes),
        password,
      }));
      const output = job.path("out.pdf");
      const res = this.qpdf.run(mergeArgs(inputs, output));
      if (res.code === EXIT_ERROR || !job.exists("out.pdf")) {
        return {
          status: "failed",
          ...describeMergeFailure(
            res.stderr,
            inputs.map((i) => i.path),
          ),
        };
      }
      return {
        status: "merged",
        bytes: job.read("out.pdf"),
        warnings:
          res.code === EXIT_WARNINGS
            ? friendlyQpdfMessage(res.stderr)
            : undefined,
      };
    });
  }
}
