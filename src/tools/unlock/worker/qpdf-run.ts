/** Pure helpers for interpreting qpdf's output (no WASM needed, unit tested). */

export const EXIT_OK = 0;
export const EXIT_ERROR = 2;
export const EXIT_WARNINGS = 3;

export function isInvalidPassword(stderr: string): boolean {
  return /invalid password/i.test(stderr);
}

/** Turn qpdf's stderr into something a person can read. */
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

const OOM_PATTERNS = [
  /out of memory/i,
  /memory access out of bounds/i,
  /Cannot enlarge memory/i,
  /Array buffer allocation failed/i,
  /Aborted\(.*(OOM|memory)/i,
];

export function isOutOfMemory(err: unknown): boolean {
  if (err instanceof RangeError) return true;
  const text = err instanceof Error ? err.message : String(err);
  return OOM_PATTERNS.some((p) => p.test(text));
}
