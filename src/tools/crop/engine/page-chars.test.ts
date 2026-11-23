import { describe, expect, it } from "vitest";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { fakeCropPdfium } from "../test-utils/fake-crop-pdfium";
import { readPageChars } from "./page-chars";

describe("readPageChars", () => {
  it("reads real characters with their box and origin, skipping generated ones", () => {
    const { api, runtime } = fakeCropPdfium();
    const heap = new WasmHeap(runtime);
    api.FPDFText_CountChars.mockReturnValue(3);
    api.FPDFText_IsGenerated.mockImplementation((_tp, i) => (i === 1 ? 1 : 0));
    api.FPDFText_GetUnicode.mockImplementation((_tp, i) => 65 + i);
    api.FPDFText_GetCharBox.mockImplementation((_tp, i, l, r, b, t) => {
      [l, r, b, t].forEach((ptr, k) => runtime.setValue(ptr, i * 10 + k));
      return true;
    });
    api.FPDFText_GetCharOrigin.mockImplementation((_tp, i, x, y) => {
      runtime.setValue(x, i * 100);
      runtime.setValue(y, 7);
      return true;
    });
    expect(readPageChars(api, heap, 5)).toEqual([
      {
        unicode: 65,
        x: 0,
        y: 7,
        box: { left: 0, right: 1, bottom: 2, top: 3 },
      },
      {
        unicode: 67,
        x: 200,
        y: 7,
        box: { left: 20, right: 21, bottom: 22, top: 23 },
      },
    ]);
    expect(api.FPDFText_LoadPage).toHaveBeenCalledWith(5);
    expect(api.FPDFText_ClosePage).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
  });

  it("skips characters PDFium cannot place", () => {
    const { api, runtime } = fakeCropPdfium();
    api.FPDFText_CountChars.mockReturnValue(2);
    api.FPDFText_GetCharBox.mockImplementation((_tp, i) => i !== 0);
    api.FPDFText_GetCharOrigin.mockReturnValue(false);
    expect(readPageChars(api, new WasmHeap(runtime), 1)).toEqual([]);
  });

  it("fails without a text page, and closes it when reading throws", () => {
    const { api, runtime } = fakeCropPdfium();
    api.FPDFText_LoadPage.mockReturnValue(0);
    expect(() => readPageChars(api, new WasmHeap(runtime), 1)).toThrow(
      "Could not read the text",
    );
    const other = fakeCropPdfium();
    other.api.FPDFText_CountChars.mockReturnValue(1);
    other.api.FPDFText_GetUnicode.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() =>
      readPageChars(other.api, new WasmHeap(other.runtime), 1),
    ).toThrow("boom");
    expect(other.api.FPDFText_ClosePage).toHaveBeenCalledTimes(1);
    expect(other.runtime.leaks()).toEqual([]);
  });
});
