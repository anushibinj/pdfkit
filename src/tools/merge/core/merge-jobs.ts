import type { QpdfJob } from "@/lib/qpdf/qpdf-job";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { scratchFiles } from "@/lib/qpdf/scratch-files";

/**
 * qpdf's page range for "every page, in order" (`z` is the last page).
 *
 * Always written out. In a job file the range may be left out, but on the
 * command line the qpdf 11.0.0 build pdfkit ships fails with "unexpected
 * character" when it is (although the manual says it is optional; both were
 * checked against the real binary). Spelling it out keeps the job correct
 * in either form and in every qpdf version.
 */
export const ALL_PAGES = "1-z";

/** One input file in qpdf's in-memory file system. */
export interface MergeInputFile {
  /** Absolute path, e.g. "/job-3-ab12cd-in-0.pdf". */
  path: string;
  /** The password that opens it, if it needs one. */
  password?: string;
}

/** Paths in qpdf's file system used by one merge. */
export interface MergeScratchFiles {
  /** One per source, in source order. */
  readonly inputs: readonly string[];
  /** Where qpdf writes the merged PDF. */
  readonly output: string;
  /** The job JSON file (it holds the passwords). */
  readonly job: string;
}

/**
 * Name the files of one merge.
 *
 * The output and the job file are named exactly as every other qpdf tool
 * names them (`scratchFiles`). The inputs follow the same pattern with an
 * index, "/job-<token>-in-<i>.pdf", so `friendlyQpdfMessage` strips them from
 * qpdf's messages like any other job file, and each source gets its own file
 * even when the same PDF was added twice.
 *
 * @param token From `newScratchToken`.
 * @param count How many sources.
 * @returns The paths.
 */
export function mergeScratchFiles(
  token: string,
  count: number,
): MergeScratchFiles {
  const { output, job } = scratchFiles(token);
  const inputs = Array.from(
    { length: count },
    (_, i) => `/job-${token}-in-${i}.pdf`,
  );
  return { inputs, output, job };
}

/**
 * Delete every file of a merge, ignoring the ones never created. Called from
 * `finally`, so no input, result or password outlives the job.
 *
 * @param runner A loaded qpdf.
 * @param files The merge's files.
 */
export function removeMergeScratchFiles(
  runner: QpdfRunner,
  files: MergeScratchFiles,
): void {
  for (const input of files.inputs) runner.remove(input);
  runner.remove(files.output);
  runner.remove(files.job);
}

/**
 * The password field of a job entry, if there is a password.
 *
 * An empty password is left out: a file whose user password is empty opens
 * without one, so it would add nothing.
 *
 * @param password The user password, if any.
 * @returns `{ password }` or an empty object, to spread into a job.
 */
function passwordField(password?: string): { password?: string } {
  return password ? { password } : {};
}

/**
 * Build the job that prints a PDF's page count on stdout.
 *
 * `showNpages` opens the file fully, so it also proves the file is a readable
 * PDF and that the password, if any, is right: qpdf answers "invalid
 * password" both when a password is missing and when it is wrong.
 *
 * @param path The PDF in qpdf's file system.
 * @param password Its password, if any.
 * @returns The job description for `runQpdfJob`.
 */
export function pageCountJob(path: string, password?: string): QpdfJob {
  return { inputFile: path, ...passwordField(password), showNpages: "" };
}

/**
 * Build the job that merges every page of `inputs`, in order, into `output`.
 *
 * It is `qpdf --empty --pages <file> [--password=...] 1-z ... -- <output>`
 * written as a job:
 * - `empty` starts from a document with no pages instead of the first input,
 *   so every input is treated the same. Per the qpdf manual, document-level
 *   data (the outline/bookmarks, document properties) is then taken from
 *   none of the inputs, and the output is not encrypted. Each page keeps its
 *   content, annotations and links, and qpdf (10.2 and later) copies the
 *   form fields of the copied pages.
 * - `pages` lists the inputs in output order, each with its own password,
 *   which in JSON reaches qpdf exactly as typed whatever characters it has
 *   (see `runQpdfJob`).
 *
 * @param inputs The files, in the order their pages should appear.
 * @param output Where qpdf writes the merged file.
 * @returns The job description for `runQpdfJob`.
 * @throws When `inputs` is empty (qpdf would write a PDF with no pages).
 */
export function mergeJob(
  inputs: readonly MergeInputFile[],
  output: string,
): QpdfJob {
  if (inputs.length === 0) throw new Error("Nothing to merge");
  return {
    empty: "",
    outputFile: output,
    pages: inputs.map(({ path, password }) => ({
      file: path,
      ...passwordField(password),
      range: ALL_PAGES,
    })),
  };
}
