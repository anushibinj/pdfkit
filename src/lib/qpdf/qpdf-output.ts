/** Pure helpers for interpreting qpdf's output (no WASM needed, unit tested). */

/** qpdf finished without problems. */
export const EXIT_OK = 0;
/** qpdf failed; no usable output was written. */
export const EXIT_ERROR = 2;
/** qpdf succeeded but reported warnings (e.g. it repaired a damaged file). */
export const EXIT_WARNINGS = 3;

/**
 * Decide whether qpdf refused a file because of its password.
 *
 * qpdf reports this as "<file>: invalid password", both when no password
 * was given for a file that needs one and when the given one is wrong; the
 * caller knows which case it is from whether it passed a password.
 *
 * @param stderr qpdf's standard error.
 * @returns `true` when the message is about the password.
 */
export function isInvalidPassword(stderr: string): boolean {
  return /invalid password/i.test(stderr);
}

/**
 * Turn qpdf's standard error into a sentence a person can read.
 *
 * qpdf prefixes every line with the program name and the file path
 * ("qpdf: /job-1-in.pdf: can't find startxref"). Both prefixes mean nothing
 * to the user (the path is an internal name in WebAssembly memory), so they
 * are removed, and the two most common failures get plain explanations:
 * - a missing header or cross-reference table means the file is not a PDF,
 *   or is damaged;
 * - an unsupported encryption or filter is named as such, with qpdf's own
 *   words kept in brackets for anyone who needs the detail.
 *
 * @param stderr qpdf's standard error (may be empty).
 * @returns A message that starts with a capital letter.
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
        .replace(/^\/job-[\w-]+\.pdf:\s*/i, ""),
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
