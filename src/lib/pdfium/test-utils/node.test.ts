// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadNodePdfiumModule, pixelAt, toArrayBuffer } from "./node";

describe("loadNodePdfiumModule", () => {
  it("instantiates the real PDFium build", async () => {
    const pdfium = await loadNodePdfiumModule();
    expect(typeof pdfium.FPDF_LoadMemDocument).toBe("function");
    expect(pdfium.pdfium.HEAPU8.length).toBeGreaterThan(0);
  });
});

describe("pixelAt", () => {
  it("reads the RGB of the pixel at a rounded position", () => {
    const img = {
      width: 2,
      pixels: new Uint8Array([
        1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
      ]),
    };
    expect(pixelAt(img, 1, 0)).toEqual([4, 5, 6]);
    expect(pixelAt(img, 0.4, 1.2)).toEqual([7, 8, 9]);
  });
});

describe("toArrayBuffer", () => {
  it("copies exactly the viewed bytes", () => {
    const view = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
    expect(Array.from(new Uint8Array(toArrayBuffer(view)))).toEqual([1, 2]);
  });
});
