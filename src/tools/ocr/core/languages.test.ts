import { describe, expect, it } from "vitest";
import {
  formatLanguageCodes,
  formatLanguageNames,
  getLanguageInfo,
  isValidLanguageCode,
  normalizeLanguageSelection,
  OCR_LANGUAGES,
} from "./languages";

describe("OCR languages", () => {
  it("includes English and 10 Indian languages", () => {
    const codes = OCR_LANGUAGES.map((l) => l.code);
    expect(codes).toEqual([
      "eng",
      "hin",
      "ben",
      "tam",
      "tel",
      "kan",
      "mal",
      "mar",
      "guj",
      "pan",
      "ori",
    ]);
  });

  it("validates supported language codes", () => {
    expect(isValidLanguageCode("eng")).toBe(true);
    expect(isValidLanguageCode("hin")).toBe(true);
    expect(isValidLanguageCode("tel")).toBe(true);
    expect(isValidLanguageCode("xyz")).toBe(false);
  });

  it("looks up metadata by code", () => {
    expect(getLanguageInfo("hin")).toEqual({
      code: "hin",
      name: "Hindi",
      nativeName: "हिन्दी",
      script: "Devanagari",
    });
    expect(getLanguageInfo("unknown")).toBeUndefined();
  });

  it("normalizes, deduplicates, and orders selected language codes", () => {
    expect(normalizeLanguageSelection(["hin", "invalid", "eng", "hin"])).toEqual([
      "eng",
      "hin",
    ]);
    expect(normalizeLanguageSelection([])).toEqual([]);
  });

  it("formats Tesseract language specs and display names", () => {
    expect(formatLanguageCodes(["hin", "eng"])).toBe("eng+hin");
    expect(formatLanguageCodes([])).toBe("eng");
    expect(formatLanguageNames(["eng", "hin", "tam"])).toBe(
      "English + Hindi + Tamil",
    );
    expect(formatLanguageNames([])).toBe("None selected");
  });
});
