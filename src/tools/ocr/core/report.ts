/**
 * Report aggregation and human-readable summary formatting for OCR results.
 *
 * Follows Single Responsibility Principle (SRP) by computing page statistics,
 * word counts, and combined `.txt` text output without side effects.
 */

import type { OcrPageResult, OcrReport } from "./model";

/**
 * Counts whitespace-delimited words in a UTF-8 string (works across Latin and Indic scripts).
 *
 * @param text Input text.
 * @returns Number of non-empty tokens.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Counts non-whitespace Unicode characters in `text`.
 *
 * @param text Input text.
 * @returns Count of non-whitespace characters.
 */
export function countNonWhitespaceChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/**
 * Aggregates per-page {@link OcrPageResult} records into a single {@link OcrReport}.
 *
 * @param pages Ordered per-page results.
 * @returns Aggregated {@link OcrReport}.
 */
export function buildOcrReport(pages: readonly OcrPageResult[]): OcrReport {
  let ocrPagesCount = 0;
  let skippedPagesCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let totalWords = 0;
  let totalCharacters = 0;

  const textSections: string[] = [];

  for (const page of pages) {
    if (page.status === "ocr") {
      ocrPagesCount++;
      if (page.confidence !== null && Number.isFinite(page.confidence)) {
        confidenceSum += page.confidence;
        confidenceCount++;
      }
    } else {
      skippedPagesCount++;
    }

    totalWords += page.wordCount;
    totalCharacters += countNonWhitespaceChars(page.text);

    const trimmed = page.text.trim();
    if (pages.length === 1) {
      if (trimmed) textSections.push(trimmed);
    } else {
      textSections.push(
        `--- Page ${page.pageIndex + 1} ---\n${trimmed || "(no text detected)"}`,
      );
    }
  }

  return {
    totalPages: pages.length,
    ocrPagesCount,
    skippedPagesCount,
    averageConfidence:
      confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : null,
    totalWords,
    totalCharacters,
    fullText: textSections.join("\n\n"),
    pages: [...pages],
  };
}

/**
 * Formats a concise human-readable summary of an {@link OcrReport}.
 *
 * @param report Aggregated OCR report.
 * @returns Summary sentence for the file row or status banner.
 */
export function formatOcrSummary(report: OcrReport): string {
  const parts: string[] = [];

  if (report.ocrPagesCount > 0) {
    const pageWord = report.ocrPagesCount === 1 ? "page" : "pages";
    const conf =
      report.averageConfidence !== null
        ? ` (${report.averageConfidence}% avg. confidence)`
        : "";
    parts.push(`${report.ocrPagesCount} ${pageWord} recognized${conf}`);
  }

  if (report.skippedPagesCount > 0) {
    const pageWord = report.skippedPagesCount === 1 ? "page" : "pages";
    parts.push(
      `${report.skippedPagesCount} ${pageWord} with existing text skipped`,
    );
  }

  if (parts.length === 0) {
    return "No pages processed";
  }

  const wordLabel = report.totalWords === 1 ? "1 word" : `${report.totalWords} words`;
  return `${parts.join(", ")} · ${wordLabel}`;
}
