import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCR_OPTIONS,
  isSupportedOcrFile,
  normalizeOcrOptions,
  ocrPdfFileName,
  ocrTxtFileName,
  validateOcrOptions,
} from "./options";

describe("OCR options", () => {
  it("validates default options", () => {
    expect(validateOcrOptions(DEFAULT_OCR_OPTIONS)).toBeNull();
  });

  it("rejects empty or invalid language selections and invalid DPI", () => {
    expect(
      validateOcrOptions({ ...DEFAULT_OCR_OPTIONS, languages: [] }),
    ).toMatch(/Select at least one language/i);

    expect(
      validateOcrOptions({
        ...DEFAULT_OCR_OPTIONS,
        languages: ["invalid" as "eng"],
      }),
    ).toMatch(/Unsupported OCR language/i);

    expect(
      validateOcrOptions({
        ...DEFAULT_OCR_OPTIONS,
        dpi: 999 as 300,
      }),
    ).toMatch(/150, 200, or 300 DPI/i);
  });

  it("normalizes options defensively", () => {
    expect(
      normalizeOcrOptions({
        languages: ["tam", "eng", "tam"],
        dpi: 200,
        redoExistingText: true,
        enhanceScan: false,
      }),
    ).toEqual({
      languages: ["eng", "tam"],
      dpi: 200,
      redoExistingText: true,
      enhanceScan: false,
    });

    expect(
      normalizeOcrOptions({
        languages: [],
        dpi: 600 as 300,
        redoExistingText: false,
        enhanceScan: true,
      }),
    ).toEqual({
      languages: ["eng"],
      dpi: 300,
      redoExistingText: false,
      enhanceScan: true,
    });
  });

  it("recognizes PDF, PNG, and JPEG files and rejects unsupported extensions", () => {
    expect(isSupportedOcrFile({ name: "scan.pdf", type: "application/pdf" })).toBe(true);
    expect(isSupportedOcrFile({ name: "scan.png", type: "image/png" })).toBe(true);
    expect(isSupportedOcrFile({ name: "photo.jpg", type: "image/jpeg" })).toBe(true);
    expect(isSupportedOcrFile({ name: "photo.JPEG", type: "" })).toBe(true);
    expect(isSupportedOcrFile({ name: "notes.txt", type: "text/plain" })).toBe(false);
  });

  it("builds -ocr.pdf and -ocr.txt output names", () => {
    expect(ocrPdfFileName("scanned.pdf")).toBe("scanned-ocr.pdf");
    expect(ocrPdfFileName("page.png")).toBe("page-ocr.pdf");
    expect(ocrTxtFileName("receipt.jpeg")).toBe("receipt-ocr.txt");
    expect(ocrPdfFileName("")).toBe("document-ocr.pdf");
  });
});
