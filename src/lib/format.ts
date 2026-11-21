const UNITS = ["B", "KB", "MB", "GB"] as const;

/** Human readable size: 1536 -> "1.5 KB". Uses 1024 steps. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${Number(value.toFixed(digits))} ${UNITS[unit]}`;
}

/** "report.pdf" -> "report-unlocked.pdf". Always ends in .pdf. */
export function suffixedPdfName(name: string, suffix: string): string {
  const base = name.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}${suffix}.pdf`;
}

/**
 * Name the PDF made from a source file: "notes.md" becomes "notes.pdf".
 *
 * Only an extension matched by `extension` is removed, so a name with some
 * other extension keeps it ("archive.tar" -> "archive.tar.pdf") instead of
 * losing part of its name. With no source file (text typed into an editor),
 * or a name that is empty after the extension is removed and the rest is
 * trimmed, the result is "document.pdf".
 *
 * @param sourceName The opened file's name, if any.
 * @param extension Matches the extensions to drop; must be anchored with `$`.
 * @returns A file name ending in ".pdf".
 */
export function pdfFileNameFor(
  sourceName: string | undefined,
  extension: RegExp,
): string {
  const base = (sourceName ?? "").replace(extension, "").trim();
  return `${base || "document"}.pdf`;
}

/** True when the file name or MIME type indicates a PDF. */
export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
