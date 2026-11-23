/**
 * Pure helpers for reading qpdf's exit codes and stderr. Shared by every tool
 * that runs qpdf (no WASM, no DOM, unit tested).
 */

/** qpdf finished without errors or warnings. */
export const EXIT_OK = 0;
/** qpdf failed. Also used by `--requires-password` for "not encrypted". */
export const EXIT_ERROR = 2;
/** qpdf finished, but printed warnings (for example after repairing a file). */
export const EXIT_WARNINGS = 3;

/**
 * Decide whether qpdf's stderr reports a wrong or missing password.
 *
 * @param stderr Everything qpdf wrote to stderr during one run.
 * @returns `true` when qpdf said "invalid password".
 */
export function isInvalidPassword(stderr: string): boolean {
  return /invalid password/i.test(stderr);
}

/**
 * Turn qpdf's stderr into a sentence a person can read.
 *
 * qpdf prefixes every line with the program name and the file it was working
 * on ("this.program: /job-1-in.pdf: can't find startxref"). Those prefixes
 * mean nothing to a user (the paths are in a private in-memory file system),
 * so they are removed. Two families of messages are then reworded:
 * - a missing PDF header or `startxref` means the file is not a PDF, or is
 *   too damaged to read;
 * - "unsupported encryption" or an unsupported filter means qpdf cannot
 *   handle the method, which is worth saying plainly (the raw text is kept in
 *   brackets so a bug report still has the detail).
 * Anything else is returned with its first letter capitalised.
 *
 * @param stderr Everything qpdf wrote to stderr during one run.
 * @returns A readable message; never empty.
 */
export function friendlyQpdfMessage(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // "qpdf: /job-1-in.pdf: can't find startxref" -> "can't find startxref"
    .map((l) =>
      l
        .replace(/^(this\.program|qpdf|WARNING):?\s*/i, "")
        // Any internal path (scratch files, a kept source file), with the
        // byte offset qpdf adds for damaged objects: "/x.pdf (offset 12): ".
        .replace(/^\/[^\s:]+\.pdf(?: \(offset \d+\))?:\s*/i, ""),
    );
  if (lines.length === 0) return "qpdf could not process this file.";
  const text = lines.join(" ");
  if (/can't find (pdf header|startxref)|not a pdf/i.test(text)) {
    return "This does not look like a valid PDF file, or it is damaged.";
  }
  if (/unsupported encryption|unsupported.*filter/i.test(text)) {
    return `This PDF uses an encryption method that is not supported. (${text})`;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}
