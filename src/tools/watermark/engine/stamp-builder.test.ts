import { describe, expect, it, vi } from "vitest";
import { applyToPoint } from "@/lib/affine";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { WatermarkSpec } from "../core/model";
import { fakeWatermarkPdfium } from "../test-utils/fake-pdfium";
import type {
  Painter,
  PainterRegistry,
  PreparedContent,
} from "./painters/painter";
import { ARTIFACT_TAG, StampBuilder, copyMatrix } from "./stamp-builder";

const spec: WatermarkSpec = {
  content: {
    kind: "text",
    text: "X",
    font: "helvetica",
    bold: false,
    fontSize: 10,
    color: { r: 0, g: 0, b: 0 },
  },
  opacity: 0.5,
  rotation: 0,
  position: "center",
  layer: "over",
};

/** A painter whose content is a 100 x 50 box drawn by `draw`. */
function fakeRegistry(draw = vi.fn()) {
  const prepared: PreparedContent = {
    natural: { width: 100, height: 50 },
    sizeOn: () => ({ width: 200, height: 100 }),
    draw,
  };
  const painter: Painter<never> = { prepare: vi.fn(() => prepared) };
  const registry = {
    text: painter,
    image: painter,
  } as unknown as PainterRegistry;
  return { registry, painter, draw };
}

function setup() {
  const { api, runtime } = fakeWatermarkPdfium();
  const heap = new WasmHeap(runtime);
  return { api, runtime, heap };
}

describe("copyMatrix", () => {
  it("scales the natural box to the copy size before placing it", () => {
    const m = copyMatrix(
      [1, 0, 0, 1, 10, 20],
      { width: 100, height: 50 },
      { width: 200, height: 25 },
    );
    expect(applyToPoint(m, { x: 100, y: 50 })).toEqual({ x: 210, y: 45 });
  });
});

describe("StampBuilder", () => {
  it("draws the content once and places tagged copies on one page per size", () => {
    const { api, heap, runtime } = setup();
    const { registry, painter, draw } = fakeRegistry();
    api.FPDF_CreateNewDocument.mockReturnValueOnce(11).mockReturnValueOnce(22);
    api.FPDF_NewXObjectFromPage.mockReturnValue(33);
    api.FPDFPage_New.mockImplementation((_doc, index) => 40 + index);
    api.PDFiumExt_GetFileWriterSize.mockReturnValue(2);

    const out = new StampBuilder(api, heap, registry).build(spec, [
      { width: 600, height: 800 },
      { width: 800, height: 600 },
    ]);

    expect(painter.prepare).toHaveBeenCalledWith(spec.content, 0.5, {
      api,
      heap,
      doc: 11,
    });
    // scratch page 0 of doc 11, natural size; the content is drawn once
    expect(api.FPDFPage_New).toHaveBeenNthCalledWith(1, 11, 0, 100, 50);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(40);
    expect(api.FPDF_NewXObjectFromPage).toHaveBeenCalledWith(22, 11, 0);
    // one stamp page per size, one centred copy each
    expect(api.FPDFPage_New).toHaveBeenNthCalledWith(2, 22, 0, 600, 800);
    expect(api.FPDFPage_New).toHaveBeenNthCalledWith(3, 22, 1, 800, 600);
    expect(api.FPDF_NewFormObjectFromXObject).toHaveBeenCalledTimes(2);
    expect(api.FPDFPageObj_AddMark).toHaveBeenCalledWith(
      expect.any(Number),
      ARTIFACT_TAG,
    );
    // copy 200 x 100 centred on 600 x 800: x 200..400, y 350..450
    expect(api.FPDFPageObj_Transform.mock.calls[0].slice(1)).toEqual([
      2, 0, 0, 2, 200, 350,
    ]);
    expect(api.FPDFPage_GenerateContent).toHaveBeenCalledTimes(3);
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(3);
    expect(api.FPDF_CloseXObject).toHaveBeenCalledWith(33);
    expect(api.FPDF_CloseDocument.mock.calls).toEqual([[22], [11]]);
    expect(out).toHaveLength(2);
    expect(runtime.leaks()).toEqual([]);
  });

  it("closes everything when drawing fails", () => {
    const { api, heap } = setup();
    const { registry } = fakeRegistry(
      vi.fn(() => {
        throw new Error("draw failed");
      }),
    );
    expect(() =>
      new StampBuilder(api, heap, registry).build(spec, [
        { width: 1, height: 1 },
      ]),
    ).toThrow("draw failed");
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(1);
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(2);
    expect(api.FPDF_NewXObjectFromPage).not.toHaveBeenCalled();
  });

  it("closes the XObject and documents when a copy cannot be tagged", () => {
    const { api, heap } = setup();
    const { registry } = fakeRegistry();
    api.FPDFPageObj_AddMark.mockReturnValue(0);
    expect(() =>
      new StampBuilder(api, heap, registry).build(spec, [
        { width: 600, height: 800 },
      ]),
    ).toThrow("PDFium could not tag the watermark");
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledTimes(1);
    expect(api.FPDF_CloseXObject).toHaveBeenCalledTimes(1);
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(2);
  });

  it("reports a refused XObject", () => {
    const { api, heap } = setup();
    api.FPDF_NewXObjectFromPage.mockReturnValue(0);
    expect(() =>
      new StampBuilder(api, heap, fakeRegistry().registry).build(spec, []),
    ).toThrow("could not reuse the watermark");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(2);
  });
});
