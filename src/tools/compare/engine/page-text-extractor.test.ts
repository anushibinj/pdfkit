import { describe, expect, it } from "vitest";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import {
  fakeComparePdfium,
  writeDoublesToHeap,
} from "../test-utils/fake-compare-pdfium";
import { PdfiumPageTextExtractor } from "./page-text-extractor";

describe("PdfiumPageTextExtractor", () => {
  it("extracts tokens with glyph boxes, skips invalid code points, and frees resources", () => {
    const { api, runtime } = fakeComparePdfium();
    const heap = new WasmHeap(api.pdfium);

    const chars = [
      { code: 72, gen: 0, box: [10, 16, 700, 712] },
      { code: 105, gen: 0, box: [16, 19, 700, 712] },
      { code: 32, gen: 1, box: [0, 0, 0, 0] },
      { code: 0xd800, gen: 0, box: [0, 0, 0, 0] },
      { code: 33, gen: 0, box: [22, 25, 700, 712] },
    ];

    api.FPDFText_CountChars.mockReturnValue(chars.length);
    api.FPDFText_GetUnicode.mockImplementation((_tp, idx) => chars[idx].code);
    api.FPDFText_IsGenerated.mockImplementation((_tp, idx) => chars[idx].gen);
    api.FPDFText_GetCharBox.mockImplementation((_tp, idx, leftPtr) => {
      writeDoublesToHeap(runtime, leftPtr, chars[idx].box);
      return true;
    });

    const doc = PdfiumDocument.open(api, heap, new Uint8Array([1, 2, 3]), "");
    try {
      const extractor = new PdfiumPageTextExtractor(api, heap);
      const extracted = extractor.extractPage(doc, 0);

      expect(extracted.hasText).toBe(true);
      expect(extracted.tokens.map((t) => t.text)).toEqual(["Hi", "!"]);
      expect(extracted.tokens[0].boxes).toEqual([
        { left: 10, bottom: 700, right: 16, top: 712 },
        { left: 16, bottom: 700, right: 19, top: 712 },
      ]);
      expect(api.FPDFText_ClosePage).toHaveBeenCalledTimes(1);
    } finally {
      doc.close();
    }

    expect(runtime.leaks()).toEqual([]);
  });

  it("closes textPage even if reading throws", () => {
    const { api, runtime } = fakeComparePdfium();
    const heap = new WasmHeap(api.pdfium);
    api.FPDFText_CountChars.mockImplementation(() => {
      throw new Error("boom");
    });

    const doc = PdfiumDocument.open(api, heap, new Uint8Array([1]), "");
    try {
      const extractor = new PdfiumPageTextExtractor(api, heap);
      expect(() => extractor.extractPage(doc, 0)).toThrow("boom");
      expect(api.FPDFText_ClosePage).toHaveBeenCalledTimes(1);
    } finally {
      doc.close();
    }
    expect(runtime.leaks()).toEqual([]);
  });
});
