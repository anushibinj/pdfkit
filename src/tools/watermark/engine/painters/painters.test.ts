import { describe, expect, it } from "vitest";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { ImageSpec, TextSpec } from "../../core/model";
import { TEXT_PADDING_RATIO } from "../../core/text-block";
import { fakeWatermarkPdfium } from "../../test-utils/fake-pdfium";
import {
  IMAGE_NATURAL_SIDE,
  ImagePainter,
  PICTURE_UNREADABLE,
  imageNaturalSize,
  imageSizeOn,
  readDecodedSize,
} from "./image-painter";
import { painterFor, toAlpha } from "./painter";
import { createPainterRegistry } from "./registry";
import { TextPainter, measureLine } from "./text-painter";

const DOC = 5;
const PAGE = 9;

function setup() {
  const { api, runtime } = fakeWatermarkPdfium();
  const heap = new WasmHeap(runtime);
  return { api, runtime, heap, ctx: { api, heap, doc: DOC } };
}

const text: TextSpec = {
  kind: "text",
  text: "AB\n\nC",
  font: "times",
  bold: true,
  fontSize: 20,
  color: { r: 10, g: 20, b: 30 },
};

const image: ImageSpec = {
  kind: "image",
  mime: "image/png",
  bytes: new Uint8Array([1, 2, 3]),
  pixelWidth: 400,
  pixelHeight: 100,
  scale: 0.5,
};

describe("toAlpha", () => {
  it("maps 0..1 to 0..255 and clamps", () => {
    expect(toAlpha(0.3)).toBe(77);
    expect(toAlpha(1)).toBe(255);
    expect(toAlpha(2)).toBe(255);
    expect(toAlpha(-1)).toBe(0);
  });
});

describe("painterFor / createPainterRegistry", () => {
  it("picks the painter registered for the content's kind", () => {
    const registry = createPainterRegistry();
    expect(painterFor(registry, text)).toBeInstanceOf(TextPainter);
    expect(painterFor(registry, image)).toBeInstanceOf(ImagePainter);
  });
});

describe("measureLine", () => {
  it("measures a temporary object and always destroys it", () => {
    const { api, runtime, ctx } = setup();
    api.FPDFPageObj_NewTextObj.mockReturnValue(77);
    api.FPDFPageObj_GetBounds.mockImplementation((_o, l, b, r, t) => {
      runtime.setValue(l, 1);
      runtime.setValue(b, -2);
      runtime.setValue(r, 30);
      runtime.setValue(t, 14);
      return true;
    });
    expect(measureLine(ctx, "Helvetica", 20, "Hi")).toEqual({
      left: 1,
      bottom: -2,
      right: 30,
      top: 14,
    });
    expect(api.FPDFPageObj_NewTextObj).toHaveBeenCalledWith(
      DOC,
      "Helvetica",
      20,
    );
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledWith(77);
    expect(runtime.leaks()).toEqual([]);
  });

  it("destroys the object when measuring fails, and reports creation failures", () => {
    const { api, ctx } = setup();
    api.FPDFPageObj_GetBounds.mockReturnValue(false);
    expect(() => measureLine(ctx, "Helvetica", 20, "Hi")).toThrow(
      "PDFium could not measure the text",
    );
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledTimes(1);
    api.FPDFPageObj_NewTextObj.mockReturnValue(0);
    expect(() => measureLine(ctx, "Helvetica", 20, "Hi")).toThrow(
      "could not create a text object",
    );
  });
});

describe("TextPainter", () => {
  it("measures non-blank lines, sizes the block and draws each line with the opacity", () => {
    const { api, runtime, ctx } = setup();
    api.FPDFPageObj_GetBounds.mockImplementation((_o, l, b, r, t) => {
      [0, 0, 40, 14].forEach((v, i) => runtime.setValue([l, b, r, t][i], v));
      return true;
    });
    const prepared = new TextPainter().prepare(text, 0.5, ctx);
    const pad = TEXT_PADDING_RATIO * text.fontSize;
    // lines 1 and 3 measured (14 high), two line steps (48) apart
    expect(prepared.natural).toEqual({
      width: 40 + 2 * pad,
      height: 62 + 2 * pad,
    });
    expect(prepared.sizeOn({ width: 1, height: 1 })).toBe(prepared.natural);

    api.FPDFPageObj_Destroy.mockClear();
    prepared.draw(PAGE);
    expect(api.FPDFPageObj_NewTextObj).toHaveBeenLastCalledWith(
      DOC,
      "Times-Bold",
      20,
    );
    expect(api.FPDFPageObj_SetFillColor).toHaveBeenCalledWith(
      expect.any(Number),
      10,
      20,
      30,
      128,
    );
    expect(api.FPDFPage_InsertObject).toHaveBeenCalledTimes(2); // blank line skipped
    expect(
      api.FPDFPageObj_Transform.mock.calls.map((c) => [c[5], c[6]]),
    ).toEqual([
      [pad, pad + 48],
      [pad, pad],
    ]);
    expect(api.FPDFPageObj_Destroy).not.toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });
});

describe("imageNaturalSize / imageSizeOn", () => {
  it("keeps the aspect ratio with the longer side fixed", () => {
    expect(imageNaturalSize(400, 100)).toEqual({
      width: IMAGE_NATURAL_SIDE,
      height: 250,
    });
    expect(imageNaturalSize(100, 400)).toEqual({
      width: 250,
      height: IMAGE_NATURAL_SIDE,
    });
  });

  it("sizes a copy by the page width", () => {
    expect(imageSizeOn(image, { width: 600, height: 800 })).toEqual({
      width: 300,
      height: 75,
    });
  });
});

describe("readDecodedSize", () => {
  it("returns the decoded size and frees its memory", () => {
    const { api, runtime, ctx } = setup();
    api.FPDFImageObj_GetImagePixelSize.mockImplementation((_i, w, h) => {
      runtime.setValue(w, 37);
      runtime.setValue(h, 21);
      return true;
    });
    expect(readDecodedSize(ctx, 7)).toEqual({ width: 37, height: 21 });
    expect(api.FPDFImageObj_GetImagePixelSize).toHaveBeenCalledWith(
      7,
      expect.any(Number),
      expect.any(Number),
    );
    expect(runtime.leaks()).toEqual([]);
  });

  it("returns null for a picture PDFium could not decode (0 x 0) or a failed call", () => {
    const { api, runtime, ctx } = setup();
    api.FPDFImageObj_GetImagePixelSize.mockImplementation((_i, w, h) => {
      runtime.setValue(w, 0);
      runtime.setValue(h, 0);
      return true;
    });
    expect(readDecodedSize(ctx, 7)).toBeNull();
    api.FPDFImageObj_GetImagePixelSize.mockReturnValue(false);
    expect(readDecodedSize(ctx, 7)).toBeNull();
  });
});

describe("ImagePainter", () => {
  it("embeds a PNG, sets the opacity and stretches it over the natural box", () => {
    const { api, runtime, ctx } = setup();
    const prepared = new ImagePainter().prepare(image, 0.3, ctx);
    expect(prepared.natural).toEqual({ width: 1000, height: 250 });
    expect(prepared.sizeOn({ width: 600, height: 800 })).toEqual({
      width: 300,
      height: 75,
    });
    prepared.draw(PAGE);
    expect(api.EPDFImageObj_SetPng).toHaveBeenCalledWith(
      PAGE,
      0,
      expect.any(Number),
      expect.any(Number),
      3,
    );
    expect(api.EPDFImageObj_SetJpeg).not.toHaveBeenCalled();
    expect(api.FPDFPageObj_SetFillColor).toHaveBeenCalledWith(
      expect.any(Number),
      0,
      0,
      0,
      77,
    );
    expect(api.FPDFPageObj_Transform).toHaveBeenCalledWith(
      expect.any(Number),
      1000,
      0,
      0,
      250,
      0,
      0,
    );
    expect(api.FPDFPage_InsertObject).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
  });

  it("uses the JPEG loader for JPEGs", () => {
    const { api, ctx } = setup();
    new ImagePainter()
      .prepare({ ...image, mime: "image/jpeg" }, 1, ctx)
      .draw(PAGE);
    expect(api.EPDFImageObj_SetJpeg).toHaveBeenCalled();
    expect(api.EPDFImageObj_SetPng).not.toHaveBeenCalled();
  });

  it("refuses a picture that loads but decodes to nothing (a damaged file)", () => {
    const { api, runtime, ctx } = setup();
    api.FPDFImageObj_GetImagePixelSize.mockReturnValue(false);
    expect(() => new ImagePainter().prepare(image, 1, ctx).draw(PAGE)).toThrow(
      PICTURE_UNREADABLE,
    );
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledTimes(1);
    expect(api.FPDFPage_InsertObject).not.toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });

  it("destroys the object and explains when the picture cannot be decoded", () => {
    const { api, runtime, ctx } = setup();
    api.EPDFImageObj_SetPng.mockReturnValue(false);
    expect(() => new ImagePainter().prepare(image, 1, ctx).draw(PAGE)).toThrow(
      "could not be read",
    );
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledTimes(1);
    expect(api.FPDFPage_InsertObject).not.toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });
});
