import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_OPACITY,
  type EditObject,
  type ImageObject,
  type InkObject,
  type RectObject,
  type TextObject,
} from "../../core/model";
import { fakeMetrics } from "../../test-utils/fake-metrics";
import { fakePdfium } from "../../test-utils/fake-pdfium";
import { FILL_MODE, ROUND } from "../pdfium-api";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { HighlightWriter, RectWriter } from "./box-writers";
import { ImageWriter } from "./image-writer";
import { InkWriter } from "./ink-writer";
import type { WriteContext } from "./object-writer";
import { createWriterRegistry, writePageObjects, writerFor } from "./registry";
import { TextWriter } from "./text-writer";

const DOC = 7;
const PAGE = 8;

function setup(images: WriteContext["images"] = new Map()) {
  const { api, runtime } = fakePdfium();
  const ctx: WriteContext = {
    api,
    heap: new WasmHeap(runtime),
    doc: DOC,
    page: PAGE,
    images,
  };
  return { api, runtime, ctx };
}

const frame = { id: "o", x: 100, y: 200, rotation: 0 } as const;
const red = { r: 255, g: 0, b: 0 };

describe("TextWriter", () => {
  const text: TextObject = {
    ...frame,
    kind: "text",
    text: "ab\n  \ncd",
    font: "mono",
    fontSize: 10,
    color: red,
  };

  it("writes one text object per non-blank line at its baseline", () => {
    const { api, runtime, ctx } = setup();
    new TextWriter(fakeMetrics).write(text, ctx);
    expect(api.FPDFPageObj_NewTextObj).toHaveBeenCalledTimes(2);
    expect(api.FPDFPageObj_NewTextObj).toHaveBeenCalledWith(DOC, "Courier", 10);
    expect([...runtime.strings.values()]).toEqual(["ab", "cd"]);
    expect(api.FPDFPageObj_SetFillColor).toHaveBeenCalledWith(
      expect.any(Number),
      255,
      0,
      0,
      255,
    );
    // fake ascent 0.8 em: first baseline 8 pt below the top (user y 200 - 8)
    expect(api.FPDFPageObj_Transform.mock.calls[0].slice(1)).toEqual([
      1, 0, 0, 1, 100, 192,
    ]);
    // third line (index 2): 8 + 2 * 12 = 32 below the top
    expect(api.FPDFPageObj_Transform.mock.calls[1].slice(1)).toEqual([
      1, 0, 0, 1, 100, 168,
    ]);
    expect(runtime.leaks()).toEqual([]);
  });

  it("frees the string and destroys the object if PDFium rejects the text", () => {
    const { api, runtime, ctx } = setup();
    api.FPDFText_SetText.mockReturnValue(false);
    expect(() => new TextWriter(fakeMetrics).write(text, ctx)).toThrow(
      "set the text",
    );
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
  });
});

describe("InkWriter", () => {
  const ink: InkObject = {
    ...frame,
    kind: "ink",
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
    color: red,
    strokeWidth: 3,
  };

  it("strokes the points with round ends in the given colour and width", () => {
    const { api, ctx } = setup();
    new InkWriter().write(ink, ctx);
    expect(api.FPDFPageObj_CreateNewPath).toHaveBeenCalledWith(1, 2);
    expect(api.FPDFPath_LineTo).toHaveBeenCalledWith(expect.any(Number), 3, 4);
    expect(api.FPDFPageObj_SetStrokeWidth).toHaveBeenCalledWith(
      expect.any(Number),
      3,
    );
    expect(api.FPDFPageObj_SetLineCap).toHaveBeenCalledWith(
      expect.any(Number),
      ROUND,
    );
    expect(api.FPDFPath_SetDrawMode).toHaveBeenCalledWith(
      expect.any(Number),
      FILL_MODE.NONE,
      true,
    );
    expect(api.FPDFPageObj_Transform.mock.calls[0].slice(1)).toEqual([
      1, 0, 0, -1, 100, 200,
    ]);
  });

  it("turns a single tap into a zero-length segment (a dot)", () => {
    const { api, ctx } = setup();
    new InkWriter().write({ ...ink, points: [{ x: 5, y: 6 }] }, ctx);
    expect(api.FPDFPath_LineTo).toHaveBeenCalledWith(expect.any(Number), 5, 6);
  });
});

describe("RectWriter", () => {
  it("outlines the box without filling it", () => {
    const { api, ctx } = setup();
    const rect: RectObject = {
      ...frame,
      kind: "rect",
      width: 30,
      height: 10,
      color: red,
      strokeWidth: 2,
    };
    new RectWriter().write(rect, ctx);
    expect(api.FPDFPageObj_CreateNewRect).toHaveBeenCalledWith(0, 0, 30, 10);
    expect(api.FPDFPageObj_SetStrokeColor).toHaveBeenCalledWith(
      expect.any(Number),
      255,
      0,
      0,
      255,
    );
    expect(api.FPDFPath_SetDrawMode).toHaveBeenCalledWith(
      expect.any(Number),
      FILL_MODE.NONE,
      true,
    );
  });
});

describe("HighlightWriter", () => {
  it("fills translucently with the Multiply blend mode", () => {
    const { api, ctx } = setup();
    new HighlightWriter().write(
      { ...frame, kind: "highlight", width: 30, height: 10, color: red },
      ctx,
    );
    expect(api.FPDFPageObj_SetFillColor).toHaveBeenCalledWith(
      expect.any(Number),
      255,
      0,
      0,
      Math.round(255 * HIGHLIGHT_OPACITY),
    );
    expect(api.FPDFPath_SetDrawMode).toHaveBeenCalledWith(
      expect.any(Number),
      FILL_MODE.WINDING,
      false,
    );
    expect(api.FPDFPageObj_SetBlendMode).toHaveBeenCalledWith(
      expect.any(Number),
      "Multiply",
    );
  });
});

describe("ImageWriter", () => {
  const image: ImageObject = {
    ...frame,
    kind: "image",
    width: 40,
    height: 20,
    imageId: "a",
  };
  const bytes = new Uint8Array([1, 2, 3]).buffer;

  it.each([
    ["image/png", "EPDFImageObj_SetPng"],
    ["image/jpeg", "EPDFImageObj_SetJpeg"],
  ] as const)("embeds %s with %s and stretches it over the box", (mime, fn) => {
    const { api, runtime, ctx } = setup(
      new Map([["a", { id: "a", mime, bytes }]]),
    );
    new ImageWriter().write(image, ctx);
    expect(api[fn]).toHaveBeenCalledWith(
      PAGE,
      0,
      expect.any(Number),
      expect.any(Number),
      3,
    );
    // unit square -> 40 x 20 box whose top-left is user (100, 200)
    expect(api.FPDFPageObj_Transform.mock.calls[0].slice(1)).toEqual([
      40, 0, 0, 20, 100, 180,
    ]);
    expect(runtime.leaks()).toEqual([]);
  });

  it("fails for missing or undecodable images without leaking", () => {
    const { ctx } = setup();
    expect(() => new ImageWriter().write(image, ctx)).toThrow("missing");
    const {
      api,
      runtime,
      ctx: withImage,
    } = setup(new Map([["a", { id: "a", mime: "image/png" as const, bytes }]]));
    api.EPDFImageObj_SetPng.mockReturnValue(false);
    expect(() => new ImageWriter().write(image, withImage)).toThrow(
      "could not be read",
    );
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });
});

describe("writer registry", () => {
  it("has a writer for every kind", () => {
    const registry = createWriterRegistry(fakeMetrics);
    expect(Object.keys(registry).sort()).toEqual([
      "highlight",
      "image",
      "ink",
      "rect",
      "text",
    ]);
    expect(
      writerFor(registry, {
        ...frame,
        kind: "highlight",
        width: 1,
        height: 1,
        color: red,
      }),
    ).toBe(registry.highlight);
  });

  it("writes objects in list order, bottom-most first", () => {
    const { ctx } = setup();
    const order: string[] = [];
    const registry = createWriterRegistry(fakeMetrics);
    registry.highlight = { write: (o) => order.push(`write ${o.id}`) };
    registry.rect = { write: (o) => order.push(`write ${o.id}`) };
    const objects: EditObject[] = [
      {
        ...frame,
        id: "r",
        kind: "rect",
        width: 1,
        height: 1,
        color: red,
        strokeWidth: 1,
      },
      { ...frame, id: "h", kind: "highlight", width: 1, height: 1, color: red },
    ];
    writePageObjects(registry, objects, ctx);
    expect(order).toEqual(["write r", "write h"]);
  });
});
