/**
 * Pure helpers for interpreting qpdf's exit codes and error output (no WASM
 * needed, unit tested). Shared by every qpdf-based tool.
 */

/** qpdf finished without errors or warnings. */
export const EXIT_OK = 0;
/** qpdf failed; the output file may be missing or incomplete. */
export const EXIT_ERROR = 2;
/** qpdf finished and wrote its output, but reported warnings. */
export const EXIT_WARNINGS = 3;

/**
 * Decide whether qpdf refused a file because of its password.
 *
 * qpdf reports both "a password is needed" and "this password is wrong" as
 * "invalid password" on stderr with exit code 2.
 *
 * @param stderr What qpdf wrote to its error output.
 * @returns `true` when the password was the problem.
 */
export function isInvalidPassword(stderr: string): boolean {
  return /invalid password/i.test(stderr);
}

/**
 * Turn qpdf's stderr into something a person can read.
 *
 * Each line loses the program and file prefixes qpdf adds
 * ("qpdf: /job-1-in.pdf: can't find startxref" becomes "can't find
 * startxref"). The two most common failures (not a PDF, unsupported
 * encryption) get a plain explanation; anything else is passed through with
 * a capital first letter.
 *
 * @param stderr What qpdf wrote to its error output.
 * @returns A sentence for the UI.
 */
export function friendlyQpdfMessage(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // "qpdf: /job-1-in.pdf: can't find startxref" -> "can't find startxref"
    .map((l) =>
      l.replace(/^(this\.program|qpdf|WARNING):?\s*/i, "").replace(/^\/job-[\w-]+\.pdf:\s*/i, ""),
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
