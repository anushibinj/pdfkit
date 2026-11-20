/**
 * Pure helpers for interpreting qpdf's exit codes and stderr. Shared by every
 * tool that runs qpdf (no WASM needed, unit tested).
 */

/** qpdf finished without errors or warnings. */
export const EXIT_OK = 0;
/** qpdf failed; the output file, if any, must not be used. */
export const EXIT_ERROR = 2;
/** qpdf succeeded but printed warnings (for example, it repaired the file). */
export const EXIT_WARNINGS = 3;

/**
 * Decide whether qpdf refused a file because of its password.
 *
 * qpdf prints "invalid password" both when a password-protected file is
 * opened without a password and when the given password is wrong, so the
 * caller decides which of the two it was from whether it passed one.
 *
 * @param stderr Everything qpdf wrote to stderr for one command.
 * @returns `true` when the failure was a missing or wrong password.
 */
export function isInvalidPassword(stderr: string): boolean {
  return /invalid password/i.test(stderr);
}

/**
 * Turn qpdf's stderr into something a person can read.
 *
 * Each line loses its program prefix ("qpdf:", "this.program:" or
 * "WARNING:") and the internal virtual file name ("/job-1-in.pdf:"), which
 * would mean nothing to the user. The two failures people actually hit get a
 * plain explanation; anything else is passed through, capitalised.
 *
 * @param stderr Everything qpdf wrote to stderr for one command.
 * @returns A single human readable sentence.
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
