/**
 * Pure option defaults, validation, file predicates, and output filename helpers.
 *
 * Follows Single Responsibility Principle (SRP) by keeping validation and
 * naming rules independent of DOM, React, or WebAssembly APIs.
 */

import { isPdfFile } from "@/lib/format";
import { isValidLanguageCode, normalizeLanguageSelection } from "./languages";
import type { OcrDpi, OcrOptions } from "./model";

/** Supported rasterization DPI presets. */
export const SUPPORTED_OCR_DPIS: readonly OcrDpi[] = [150, 200, 300] as const;

/** Default OCR configuration: English at 300 DPI, skipping pages that already have text. */
export const DEFAULT_OCR_OPTIONS: OcrOptions = {
  languages: ["eng"],
  dpi: 300,
  redoExistingText: false,
  enhanceScan: false,
};

/**
 * Checks whether a dropped or selected file is a PDF, PNG, or JPEG supported by OCR.
 *
 * @param file Candidate file metadata (`name` and `type`).
 * @returns `true` if the file looks like a PDF, PNG, or JPEG.
 */
export function isSupportedOcrFile(file: { name: string; type: string }): boolean {
  return (
    isPdfFile(file) ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    /\.(png|jpe?g)$/i.test(file.name)
  );
}

/**
 * Sanitizes and validates {@link OcrOptions}, returning a user-facing error
 * string if any setting is invalid or `null` when valid.
 *
 * @param options Candidate OCR options.
 * @returns Error message or `null`.
 */
export function validateOcrOptions(options: OcrOptions): string | null {
  if (!Array.isArray(options.languages) || options.languages.length === 0) {
    return "Select at least one language for OCR.";
  }

  for (const code of options.languages) {
    if (!isValidLanguageCode(code)) {
      return `Unsupported OCR language code: ${code}.`;
    }
  }

  if (!SUPPORTED_OCR_DPIS.includes(options.dpi)) {
    return "Resolution must be 150, 200, or 300 DPI.";
  }

  return null;
}

/**
 * Returns a normalized copy of {@link OcrOptions} with deduplicated languages.
 *
 * @param options Raw options.
 * @returns Normalized {@link OcrOptions}.
 */
export function normalizeOcrOptions(options: OcrOptions): OcrOptions {
  const langs = normalizeLanguageSelection(options.languages);
  return {
    languages: langs.length > 0 ? langs : ["eng"],
    dpi: SUPPORTED_OCR_DPIS.includes(options.dpi) ? options.dpi : 300,
    redoExistingText: Boolean(options.redoExistingText),
    enhanceScan: Boolean(options.enhanceScan),
  };
}

/**
 * Builds the output searchable PDF filename (`<stem>-ocr.pdf`).
 *
 * @param inputName Original PDF or image filename.
 * @returns Output PDF filename.
 */
export function ocrPdfFileName(inputName: string): string {
  const stem = inputName.replace(/\.(pdf|png|jpe?g)$/i, "") || "document";
  return `${stem}-ocr.pdf`;
}

/**
 * Builds the output plain-text export filename (`<stem>-ocr.txt`).
 *
 * @param inputName Original PDF or image filename.
 * @returns Output `.txt` filename.
 */
export function ocrTxtFileName(inputName: string): string {
  const stem = inputName.replace(/\.(pdf|png|jpe?g)$/i, "") || "document";
  return `${stem}-ocr.txt`;
}
