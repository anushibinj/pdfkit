/**
 * Names for the downloaded files and archives. Pure.
 *
 * Every name starts with the PDF's own name, so files from several PDFs do
 * not collide in the Downloads folder, and numbers are zero-padded so the
 * files sort in page order in every file manager ("page-02" before
 * "page-10").
 */

/** Characters Windows, macOS or ZIP readers do not allow in file names. */
const UNSAFE = /[\u0000-\u001f\\/:*?"<>|]+/g;
/** Longest base name kept, so long titles still leave room for suffixes. */
const MAX_BASE_LENGTH = 100;

/** Formats of the produced files. */
export type ImageExtension = "png" | "jpg";

/**
 * The PDF's name without ".pdf", made safe to use in file names.
 *
 * Unsafe characters (path separators, Windows-reserved ones, control
 * characters) become "_". Leading and trailing dots and spaces are trimmed:
 * Windows drops trailing ones silently, and a leading dot hides a file on
 * macOS and Linux. An empty result becomes "document".
 *
 * @param fileName The name of the opened PDF, e.g. "Q3 report.pdf".
 * @returns A base name, e.g. "Q3 report".
 */
export function baseNameOf(fileName: string): string {
  const base = fileName
    .replace(/\.pdf$/i, "")
    .replace(UNSAFE, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .trim();
  return base || "document";
}

/**
 * Zero-pad a 1-based number to the width of the largest one, but at least
 * two digits.
 *
 * @param n The number, 1-based.
 * @param total The largest number in the set.
 * @returns For example "03" of 12, or "007" of 120.
 */
export function sequenceLabel(n: number, total: number): string {
  const width = Math.max(2, String(Math.max(1, total)).length);
  return String(n).padStart(width, "0");
}

/**
 * Name of one rendered page.
 *
 * @param base From {@link baseNameOf}.
 * @param pageNumber 1-based page number in the PDF.
 * @param pageCount Pages in the PDF (sets the padding).
 * @param extension File extension.
 * @returns For example "report-page-03.png".
 */
export function pageImageName(
  base: string,
  pageNumber: number,
  pageCount: number,
  extension: ImageExtension,
): string {
  return `${base}-page-${sequenceLabel(pageNumber, pageCount)}.${extension}`;
}

/**
 * Name of one extracted image.
 *
 * @param base From {@link baseNameOf}.
 * @param index 1-based position among the extracted images.
 * @param total Number of extracted images (sets the padding).
 * @param extension File extension.
 * @returns For example "report-image-07.jpg".
 */
export function extractedImageName(
  base: string,
  index: number,
  total: number,
  extension: ImageExtension,
): string {
  return `${base}-image-${sequenceLabel(index, total)}.${extension}`;
}

/**
 * Name of the ZIP holding every produced file.
 *
 * @param base From {@link baseNameOf}.
 * @param kind What the archive holds.
 * @returns For example "report-pages.zip".
 */
export function archiveName(base: string, kind: "pages" | "images"): string {
  return `${base}-${kind}.zip`;
}

/**
 * File extension for a MIME type this tool produces.
 *
 * @param mimeType "image/png" or "image/jpeg".
 * @returns "png" or "jpg".
 */
export function extensionFor(mimeType: string): ImageExtension {
  return mimeType === "image/jpeg" ? "jpg" : "png";
}
