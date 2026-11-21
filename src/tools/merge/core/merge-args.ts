/**
 * qpdf command lines for the Merge PDFs tool. Pure functions, unit tested.
 */

/**
 * qpdf's page range for "every page, in order" (`z` is the last page).
 *
 * Always written out, never omitted. The qpdf manual says the range after a
 * file in `--pages` may be omitted and then defaults to all pages, but the
 * qpdf 11.0.0 WebAssembly build pdfkit ships fails with "unexpected
 * character" whenever it is (checked against the real binary; pinned by
 * `qpdf-merger.integration.test.ts`). An explicit range works in every qpdf
 * version.
 */
export const ALL_PAGES = "1-z";

/** One input file in qpdf's virtual file system. */
export interface QpdfInputFile {
  /** Absolute virtual path, e.g. "/job-3-in-0.pdf" */
  path: string;
  /** The user password, for a password-protected file */
  password?: string;
}

/**
 * The `--password=` option for a file, if it needs one.
 *
 * An empty password is left out: an encrypted file whose user password is
 * empty opens without one, so `--password=` would add nothing.
 *
 * @param password The user password, if any.
 * @returns Zero or one argument.
 */
export function passwordArgs(password?: string): string[] {
  return password ? [`--password=${password}`] : [];
}

/**
 * Arguments that make qpdf print a file's page count on stdout.
 *
 * `--show-npages` opens the file fully, so it also proves that the file is a
 * readable PDF and that the password (if any) is right. qpdf answers
 * "invalid password" both when the password is missing and when it is wrong.
 *
 * @param input The file to count.
 * @returns The argument list (without the program name).
 */
export function pageCountArgs(input: QpdfInputFile): string[] {
  return ["--show-npages", ...passwordArgs(input.password), input.path];
}

/**
 * Arguments that merge every page of `inputs`, in order, into `outputPath`.
 *
 * The command is `--empty --pages <file> [--password=...] 1-z ... -- <out>`:
 * - `--empty` starts from an empty document instead of the first input, so
 *   every input is treated the same. Per the qpdf manual, document-level
 *   data (outlines/bookmarks, document metadata) is then taken from none of
 *   the inputs, and the output is not encrypted. Each page keeps its own
 *   content, annotations and links, and qpdf (10.2 and later) copies the
 *   form fields that belong to the copied pages.
 * - Within `--pages`, each file is followed by its own `--password=` (when
 *   it needs one) and then its page range, which is the order qpdf parses.
 * - `--` ends the page selection; the output file comes after it.
 *
 * @param inputs The files, in the order their pages should appear.
 * @param outputPath Where qpdf writes the merged file.
 * @returns The argument list (without the program name).
 * @throws When `inputs` is empty (qpdf would write an empty PDF).
 */
export function mergeArgs(
  inputs: readonly QpdfInputFile[],
  outputPath: string,
): string[] {
  if (inputs.length === 0) throw new Error("Nothing to merge");
  const selections = inputs.flatMap(({ path, password }) => [
    path,
    ...passwordArgs(password),
    ALL_PAGES,
  ]);
  return ["--empty", "--pages", ...selections, "--", outputPath];
}
