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

/** True when the file name or MIME type indicates a PDF. */
export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
