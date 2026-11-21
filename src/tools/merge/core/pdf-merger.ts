import {
  EXIT_ERROR,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-output";
import { runQpdfJob } from "@/lib/qpdf/qpdf-job";
import type { QpdfRun, QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import {
  newScratchToken,
  removeScratchFiles,
  scratchFiles,
} from "@/lib/qpdf/scratch-files";
import {
  mergeJob,
  mergeScratchFiles,
  pageCountJob,
  removeMergeScratchFiles,
} from "./merge-jobs";

/** What checking one PDF found. */
export type InspectOutcome =
  | { kind: "inspected"; pageCount: number }
  /** Encrypted with a user password, and none was given. */
  | { kind: "password-required" }
  | { kind: "wrong-password" }
  /** Unusable; `message` says why, for a person to read. */
  | { kind: "failed"; message: string };

/** One PDF to merge. */
export interface PdfSource {
  bytes: Uint8Array;
  /** The password that opens it, if it needs one. */
  password?: string;
}

/** The result of merging. */
export type MergeOutcome =
  | {
      kind: "merged";
      /** The merged PDF. May be a view into WebAssembly memory. */
      pdf: Uint8Array;
      /** qpdf's warnings, for example after repairing a damaged input. */
      warnings?: string;
    }
  | {
      kind: "failed";
      message: string;
      /** Index into the sources of the file that failed, when known. */
      sourceIndex?: number;
    };

/** Shown when qpdf reported success but printed no page count. */
export const UNCOUNTABLE_MESSAGE = "Could not count the pages of this PDF.";
/** Shown for a PDF without pages: there is nothing of it to merge. */
export const NO_PAGES_MESSAGE = "This PDF has no pages.";
/** Shown when merging refused a file's password. */
export const WRONG_PASSWORD_MESSAGE = "The password for this file is wrong.";

/**
 * Read the outcome of a page-count job.
 *
 * Decision order, and why:
 * 1. Exit code 2 (error): "invalid password" means a password is missing,
 *    or wrong when one was given (qpdf prints the same text for both). Any
 *    other error means the file is damaged or not a PDF.
 * 2. Exit 0 or 3 (3 = warnings, e.g. a repaired cross-reference table): the
 *    count is the last stdout line. Without a count the file is reported as
 *    unreadable, never guessed at.
 * 3. Zero pages is refused: there is nothing of it to merge, and the range
 *    "1-z" would fail on it at merge time.
 *
 * @param run The job's exit code and output (`stdout` must be captured).
 * @param passwordGiven Whether a password was passed.
 * @returns What the check found.
 */
export function interpretPageCount(
  run: QpdfRun,
  passwordGiven: boolean,
): InspectOutcome {
  if (run.code === EXIT_ERROR) {
    if (isInvalidPassword(run.stderr)) {
      return passwordGiven
        ? { kind: "wrong-password" }
        : { kind: "password-required" };
    }
    return { kind: "failed", message: friendlyQpdfMessage(run.stderr) };
  }
  const lastLine = (run.stdout ?? "").trim().split("\n").pop()?.trim() ?? "";
  if (!/^\d+$/.test(lastLine)) {
    return { kind: "failed", message: UNCOUNTABLE_MESSAGE };
  }
  const pageCount = Number(lastLine);
  if (pageCount === 0) return { kind: "failed", message: NO_PAGES_MESSAGE };
  return { kind: "inspected", pageCount };
}

/**
 * Work out which input a failed merge choked on, and say why.
 *
 * qpdf names the file in each stderr line ("qpdf: /job-2-ab-in-1.pdf: can't
 * find startxref"). It stops at the first fatal error, which it prints last,
 * but warnings about *earlier* files may come before it. So:
 * 1. Walk the lines from the end and take the first input path found: that
 *    is the file the fatal error is about. Paths end in ".pdf", so
 *    "/job-2-ab-in-1.pdf" can never match inside "/job-2-ab-in-10.pdf".
 * 2. Build the message only from the lines about that file, so a harmless
 *    warning about another file is not blamed on it. Without a match (a
 *    message about the output, say), every line is used.
 * 3. A wrong password gets a plain sentence.
 *
 * @param stderr Everything qpdf wrote to stderr.
 * @param inputPaths The inputs' paths, in source order.
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
    ? WRONG_PASSWORD_MESSAGE
    : friendlyQpdfMessage(text);
  return sourceIndex === undefined ? { message } : { message, sourceIndex };
}

/**
 * Checks and merges PDFs, using qpdf.
 *
 * Single responsibility: decide the steps of checking one file and of
 * merging several. Running qpdf is delegated to a {@link QpdfRunner}
 * (injected, so the steps are tested with a fake) and the job contents to
 * `merge-jobs.ts`. qpdf copies pages as PDF objects: nothing is re-rendered
 * or re-compressed, so text stays text and quality is unchanged.
 */
export class PdfMerger {
  /**
   * @param qpdf A loaded qpdf that captures stdout (page counts are read
   *   from it; see `QpdfLoadOptions.stdout`).
   * @param newToken Makes a unique token for each job's file names
   *   (injected by tests to know the names).
   */
  constructor(
    private readonly qpdf: QpdfRunner,
    private readonly newToken: () => string = newScratchToken,
  ) {}

  /**
   * Open one PDF and count its pages.
   *
   * The file is written to its own scratch path, counted through a job file
   * (so the password reaches qpdf exactly as typed), and deleted again in
   * `finally`, together with the job file that held the password.
   *
   * @param pdf The PDF's bytes.
   * @param password Its password, if the user gave one.
   * @returns The page count, or why the file cannot be used.
   * @throws Only when qpdf itself crashes (for example out of memory); the
   *   caller should then discard this qpdf instance.
   */
  inspect(pdf: Uint8Array, password?: string): InspectOutcome {
    const files = scratchFiles(this.newToken());
    try {
      this.qpdf.writeFile(files.input, pdf);
      const run = runQpdfJob(
        this.qpdf,
        files.job,
        pageCountJob(files.input, password),
      );
      return interpretPageCount(run, Boolean(password));
    } finally {
      removeScratchFiles(this.qpdf, files);
    }
  }

  /**
   * Merge every page of every source, in order.
   *
   * Steps:
   * 1. Write each source to its own scratch file ("in-0.pdf", "in-1.pdf",
   *    ...), even when two sources are the same PDF, so each keeps its own
   *    password.
   * 2. Run the merge job (see `mergeJob`). As in the other qpdf tools, a
   *    missing output counts as failure whatever the exit code, so a
   *    half-written file is never returned; exit code 3 means it worked,
   *    with warnings worth showing.
   * 3. Always delete the inputs, the output and the job file (which holds
   *    the passwords), whatever happened.
   *
   * @param sources At least one PDF, in output order.
   * @returns The merged PDF, or why merging failed.
   * @throws When `sources` is empty, or when qpdf itself crashes; the caller
   *   should then discard this qpdf instance.
   */
  merge(sources: readonly PdfSource[]): MergeOutcome {
    const files = mergeScratchFiles(this.newToken(), sources.length);
    try {
      const inputs = sources.map(({ bytes, password }, i) => {
        this.qpdf.writeFile(files.inputs[i], bytes);
        return { path: files.inputs[i], password };
      });
      const run = runQpdfJob(
        this.qpdf,
        files.job,
        mergeJob(inputs, files.output),
      );
      if (run.code === EXIT_ERROR || !this.qpdf.exists(files.output)) {
        return {
          kind: "failed",
          ...describeMergeFailure(run.stderr, files.inputs),
        };
      }
      return {
        kind: "merged",
        pdf: this.qpdf.readFile(files.output),
        warnings:
          run.code === EXIT_WARNINGS
            ? friendlyQpdfMessage(run.stderr)
            : undefined,
      };
    } finally {
      removeMergeScratchFiles(this.qpdf, files);
    }
  }
}
