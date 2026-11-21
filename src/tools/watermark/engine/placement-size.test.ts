import { describe, expect, it } from "vitest";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { fakeWatermarkPdfium } from "../test-utils/fake-pdfium";
import { readPlacementSize, readTrimBox } from "./placement-size";

function setup() {
  const { api, runtime } = fakeWatermarkPdfium();
  const heap = new WasmHeap(runtime);
  // page bounding box: 612 x 792 at the origin
  api.FPDF_GetPageBoundingBox.mockImplementation((_page, rect) => {
    [0, 792, 612, 0].forEach((v, i) => runtime.setValue(rect + i * 4, v));
    return true;
  });
  const trim = (box: [number, number, number, number] | null) =>
    api.FPDFPage_GetTrimBox.mockImplementation((_p, l, b, r, t) => {
      if (!box) return false;
      [l, b, r, t].forEach((ptr, i) => runtime.setValue(ptr, box[i]));
      return true;
    });
  const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
  return { api, runtime, heap, trim, doc };
}

describe("readTrimBox", () => {
  it("reads the four floats and frees the memory", () => {
    const { api, heap, runtime, trim } = setup();
    trim([10, 20, 110, 220]);
    expect(readTrimBox(api, heap, 1)).toEqual({
      left: 10,
      bottom: 20,
      right: 110,
      top: 220,
    });
    expect(runtime.leaks().length).toBe(1); // only the open document's file
  });

  it("returns null without a TrimBox or for a degenerate one", () => {
    const { api, heap, trim } = setup();
    trim(null);
    expect(readTrimBox(api, heap, 1)).toBeNull();
    trim([10, 20, 10, 220]);
    expect(readTrimBox(api, heap, 1)).toBeNull();
  });
});

describe("readPlacementSize", () => {
  it("uses the bounding box when there is no TrimBox", () => {
    const { api, heap, doc } = setup();
    expect(readPlacementSize(doc, api, heap, 0)).toEqual({
      width: 612,
      height: 792,
    });
  });

  it("prefers the TrimBox", () => {
    const { api, heap, doc, trim } = setup();
    trim([50, 50, 550, 750]);
    expect(readPlacementSize(doc, api, heap, 0)).toEqual({
      width: 500,
      height: 700,
    });
  });

  it("swaps width and height for a page turned a quarter", () => {
    const { api, heap, doc } = setup();
    api.FPDFPage_GetRotation.mockReturnValue(1);
    expect(readPlacementSize(doc, api, heap, 0)).toEqual({
      width: 792,
      height: 612,
    });
  });
});
