/**
 * Supported OCR languages (English + Indian scripts) backed by self-hosted
 * Tesseract `tessdata_fast` (`4.0.0_best_int`) language models.
 *
 * Follows Open/Closed Principle (OCP): adding a language requires adding one
 * entry to {@link OCR_LANGUAGES} and copying its `.traineddata.gz` in `copy-wasm.mjs`.
 */

import type { OcrLanguageCode } from "./model";

/** Metadata describing one selectable OCR language. */
export interface OcrLanguageInfo {
  /** ISO 639-2 / Tesseract traineddata code (e.g., `"eng"`, `"hin"`). */
  code: OcrLanguageCode;
  /** English display name. */
  name: string;
  /** Native script label shown alongside the English name. */
  nativeName: string;
  /** Script family for grouping/search. */
  script: string;
}

/**
 * All languages shipped with pdfkit OCR.
 * Includes English plus 10 major Indian languages (Issue #17).
 */
export const OCR_LANGUAGES: readonly OcrLanguageInfo[] = [
  { code: "eng", name: "English", nativeName: "English", script: "Latin" },
  { code: "hin", name: "Hindi", nativeName: "हिन्दी", script: "Devanagari" },
  { code: "ben", name: "Bengali", nativeName: "বাংলা", script: "Bengali" },
  { code: "tam", name: "Tamil", nativeName: "தமிழ்", script: "Tamil" },
  { code: "tel", name: "Telugu", nativeName: "తెలుగు", script: "Telugu" },
  { code: "kan", name: "Kannada", nativeName: "ಕನ್ನಡ", script: "Kannada" },
  { code: "mal", name: "Malayalam", nativeName: "മലയാളം", script: "Malayalam" },
  { code: "mar", name: "Marathi", nativeName: "मराठी", script: "Devanagari" },
  { code: "guj", name: "Gujarati", nativeName: "ગુજરાતી", script: "Gujarati" },
  { code: "pan", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", script: "Gurmukhi" },
  { code: "ori", name: "Odia", nativeName: "ଓଡ଼ିଆ", script: "Odia" },
] as const;

const LANGUAGE_MAP = new Map<string, OcrLanguageInfo>(
  OCR_LANGUAGES.map((lang) => [lang.code, lang]),
);

/**
 * Checks whether `code` is a supported OCR language identifier.
 *
 * @param code Candidate language code string.
 * @returns `true` if supported by {@link OCR_LANGUAGES}.
 */
export function isValidLanguageCode(code: string): code is OcrLanguageCode {
  return LANGUAGE_MAP.has(code);
}

/**
 * Looks up metadata for a supported OCR language code.
 *
 * @param code Language code.
 * @returns {@link OcrLanguageInfo} or `undefined` when unknown.
 */
export function getLanguageInfo(code: string): OcrLanguageInfo | undefined {
  return LANGUAGE_MAP.get(code);
}

/**
 * Deduplicates and filters a language list in canonical registry order while
 * preserving valid selections. Returns an empty array if none are valid.
 *
 * @param codes Selected language codes.
 * @returns Deduplicated valid {@link OcrLanguageCode} array.
 */
export function normalizeLanguageSelection(
  codes: readonly string[],
): OcrLanguageCode[] {
  const seen = new Set<OcrLanguageCode>();
  for (const code of codes) {
    if (isValidLanguageCode(code)) {
      seen.add(code);
    }
  }
  return OCR_LANGUAGES.filter((l) => seen.has(l.code)).map((l) => l.code);
}

/**
 * Formats selected languages into Tesseract's `+`-delimited multi-language string.
 *
 * @param codes Selected language codes (defaults to `"eng"` when empty).
 * @returns Tesseract language spec string, e.g. `"eng+hin"`.
 */
export function formatLanguageCodes(codes: readonly OcrLanguageCode[]): string {
  const normalized = normalizeLanguageSelection(codes);
  return normalized.length > 0 ? normalized.join("+") : "eng";
}

/**
 * Formats selected languages as a human-readable English list.
 *
 * @param codes Selected language codes.
 * @returns Display string such as `"English + Hindi"`.
 */
export function formatLanguageNames(codes: readonly OcrLanguageCode[]): string {
  const normalized = normalizeLanguageSelection(codes);
  if (normalized.length === 0) return "None selected";
  return normalized
    .map((code) => LANGUAGE_MAP.get(code)?.name ?? code)
    .join(" + ");
}
