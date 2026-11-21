// @vitest-environment node
/**
 * The whole watermark pipeline against the real WebAssembly builds: PDFium
 * draws the stamp, qpdf lays it onto the pages, and PDFium renders the
 * result so every claim is checked on actual pixels.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { readFileSync } from "node:fs";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  degrees,
  rgb,
  type PDFDict,
} from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import type { PdfiumCoreApi } from "@/lib/pdfium/core-api";
import { viewSize } from "@/lib/pdfium/page-box";
import { PdfOpenError, PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import {
  extractText,
  loadNodePdfiumModule,
} from "@/lib/pdfium/test-utils/node-pdfium";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { loadNodeQpdf } from "@/lib/qpdf/test-utils/node-qpdf";
import { makePng } from "@/lib/test-utils/images";
import { pageMargin } from "../core/layout";
import type { TextContent, WatermarkSettings } from "../core/model";
import { InvalidSettingsError } from "../core/sanitize-settings";
import { asWatermarkPdfiumApi } from "../worker/load-engines";
import { createPainterRegistry } from "./painters/registry";
import { WatermarkSession } from "./watermark-session";

let full: WrappedPdfiumModule;
let session: WatermarkSession;

beforeAll(async () => {
  full = await loadNodePdfiumModule();
  session = new WatermarkSession(
    asWatermarkPdfiumApi(full),
    await loadNodeQpdf(),
    createPainterRegistry(),
  );
});

// ---------------------------------------------------------------- helpers

/** Opaque red text, unrotated, centred: easy to find in a render. */
function textSettings(
  over: Partial<WatermarkSettings> = {},
  content: Partial<TextContent> = {},
): WatermarkSettings {
  return {
    content: {
      kind: "text",
      text: "WM",
      font: "helvetica",
      bold: true,
      fontSize: 120,
      color: { r: 255, g: 0, b: 0 },
      ...content,
    },
    opacity: 1,
    rotation: 0,
    position: "center",
    layer: "over",
    ...over,
  };
}

/** Build a PDF with pdf-lib (classic xref, uncompressed object streams off). */
async function makePdf(
  build: (doc: PDFDocument) => void | Promise<void>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await build(doc);
  return doc.save({ useObjectStreams: false });
}

/** A Letter PDF with `count` pages, each with a little text "Page n". */
const letterPdf = (count: number) =>
  makePdf(async (doc) => {
    for (let i = 0; i < count; i++)
      doc
        .addPage([612, 792])
        .drawText(`Page ${i + 1}`, { x: 20, y: 20, size: 10 });
  });

interface Render {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Render a page of a PDF at 1 pixel per point, as it is displayed. */
function render(bytes: Uint8Array, index: number, password = ""): Render {
  const api = full as unknown as PdfiumCoreApi;
  const heap = new WasmHeap(api.pdfium);
  const doc = PdfiumDocument.open(api, heap, bytes, password);
  try {
    const info = doc.pageInfo(index);
    const size = viewSize(info.box, info.rotation);
    return doc.render(
      index,
      Math.round(size.width),
      Math.round(size.height),
      0,
    );
  } finally {
    doc.close();
  }
}

const px = (img: Render, x: number, y: number) => {
  const o = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]];
};
const isRed = ([r, g, b]: number[]) => r > 200 && g < 80 && b < 80;
const isWhite = ([r, g, b]: number[]) => r > 250 && g > 250 && b > 250;

/** The box (in render pixels, y down) around every red pixel, or null. */
function redBox(img: Render) {
  let box: { left: number; top: number; right: number; bottom: number } | null =
    null;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!isRed(px(img, x, y))) continue;
      box = box
        ? {
            left: Math.min(box.left, x),
            top: Math.min(box.top, y),
            right: Math.max(box.right, x),
            bottom: Math.max(box.bottom, y),
          }
        : { left: x, top: y, right: x, bottom: y };
    }
  }
  return box;
}

/**
 * Check the watermark is centred on a point (render pixels, y down): the
 * centre of its red box, not a single pixel, because the centre of a text
 * often falls between two letters.
 */
function expectCentredOn(img: Render, x: number, y: number) {
  const box = redBox(img);
  expect(box).not.toBeNull();
  expect(Math.abs((box!.left + box!.right) / 2 - x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs((box!.top + box!.bottom) / 2 - y)).toBeLessThanOrEqual(1.5);
}

/**
 * A solid glyph for colour checks: the stem of a bold "I" covers the
 * centre of the copy, so the centre pixel is ink, not a gap.
 */
const SOLID = { text: "I", fontSize: 300 } as const;

/** Every indirect object of a given /Subtype in a saved PDF. */
async function objectsOfSubtype(bytes: Uint8Array, subtype: string) {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, obj]) =>
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype"))?.toString() === `/${subtype}`,
    );
}

/** The XObject references a page's resources hold (none -> []). */
async function pageXObjects(bytes: Uint8Array, index: number) {
  const doc = await PDFDocument.load(bytes);
  const xobjects = doc
    .getPage(index)
    .node.Resources()
    ?.lookup(PDFName.of("XObject")) as PDFDict | undefined;
  return xobjects
    ? xobjects.entries().map(([, v]) => (v as PDFRef).toString())
    : [];
}

// ---------------------------------------------------------------- tests

describe("WatermarkSession with real PDFium and qpdf", () => {
  it("draws a centred watermark on every page and keeps the page's own text", async () => {
    const input = await letterPdf(3);
    expect(session.open(input, "")).toBe(3);
    const out = session.apply(textSettings(), [0, 1, 2]);
    for (let i = 0; i < 3; i++) {
      const img = render(out, i);
      expectCentredOn(img, 306, 396);
      expect(isWhite(px(img, 5, 5))).toBe(true);
      expect(isWhite(px(img, 606, 786))).toBe(true);
    }
    const text = extractText(full, out);
    expect(text[0]).toContain("Page 1");
    expect(text[2]).toContain("Page 3");
  });

  it("watermarks only the selected pages", async () => {
    session.open(await letterPdf(3), "");
    const out = session.apply(textSettings(), [0, 2]);
    expectCentredOn(render(out, 0), 306, 396);
    expect(redBox(render(out, 1))).toBeNull();
    expectCentredOn(render(out, 2), 306, 396);
    expect(await pageXObjects(out, 1)).toEqual([]);
  });

  it("applies the opacity", async () => {
    session.open(await letterPdf(1), "");
    const out = session.apply(textSettings({ opacity: 0.5 }, SOLID), [0]);
    const [r, g, b] = px(render(out, 0), 306, 396);
    expect(r).toBeGreaterThan(250);
    expect(g).toBeGreaterThan(115);
    expect(g).toBeLessThan(140);
    expect(b).toBeGreaterThan(115);
    expect(b).toBeLessThan(140);
  });

  it("goes under the content or over it, as asked", async () => {
    const black = await makePdf((doc) => {
      doc.addPage([612, 792]).drawRectangle({
        x: 0,
        y: 0,
        width: 612,
        height: 792,
        color: rgb(0, 0, 0),
      });
    });
    session.open(black, "");
    const under = session.apply(textSettings({ layer: "under" }, SOLID), [0]);
    expect(px(render(under, 0), 306, 396)).toEqual([0, 0, 0]);
    const over = session.apply(textSettings({ layer: "over" }, SOLID), [0]);
    expect(isRed(px(render(over, 0), 306, 396))).toBe(true);
  });

  it("places an anchor where the reader sees it on a rotated page", async () => {
    const rotated = await makePdf((doc) => {
      doc.addPage([612, 792]).setRotation(degrees(90));
    });
    session.open(rotated, "");
    const out = session.apply(
      textSettings({ position: "top-left" }, { fontSize: 40 }),
      [0],
    );
    const img = render(out, 0);
    expect([img.width, img.height]).toEqual([792, 612]); // displayed sideways
    const box = redBox(img)!;
    const margin = pageMargin({ width: 792, height: 612 });
    // ink starts just inside margin + padding (2 pt at 40 pt), top-left
    expect(box.left).toBeGreaterThanOrEqual(margin);
    expect(box.left).toBeLessThan(margin + 10);
    expect(box.top).toBeGreaterThanOrEqual(margin);
    expect(box.top).toBeLessThan(margin + 10);
    // and the text reads upright: wider than tall
    expect(box.right - box.left).toBeGreaterThan(box.bottom - box.top);
  });

  it("lays the watermark out in the TrimBox when the page has one", async () => {
    const trimmed = await makePdf((doc) => {
      const page = doc.addPage([700, 900]);
      page.setTrimBox(50, 50, 600, 800); // 600 x 800, offset by 50
    });
    session.open(trimmed, "");
    const out = session.apply(
      textSettings({ position: "top-left" }, { fontSize: 40 }),
      [0],
    );
    const box = redBox(render(out, 0))!; // render shows the 700 x 900 media
    // TrimBox top-left in render pixels is (50, 900 - 850) = (50, 50)
    expect(box.left).toBeGreaterThanOrEqual(50 + 36);
    expect(box.left).toBeLessThan(50 + 36 + 10);
    expect(box.top).toBeGreaterThanOrEqual(50 + 36);
    expect(box.top).toBeLessThan(50 + 36 + 10);
  });

  it("keeps gradients and the original content streams intact", async () => {
    // A page drawing an axial shading with `sh`, which PDFium's own content
    // regeneration would drop.
    const gradient = await makePdf((doc) => {
      const page = doc.addPage([300, 400]);
      const ctx = doc.context;
      const shading = ctx.obj({
        ShadingType: 2,
        ColorSpace: "DeviceRGB",
        Coords: [0, 0, 300, 0],
        Function: ctx.obj({
          FunctionType: 2,
          Domain: [0, 1],
          C0: [0, 0, 1],
          C1: [0, 1, 0],
          N: 1,
        }),
        Extend: [true, true],
      });
      page.node.set(
        PDFName.of("Resources"),
        ctx.obj({ Shading: { Sh1: shading } }),
      );
      page.node.set(
        PDFName.of("Contents"),
        ctx.register(ctx.stream("q 0 0 300 100 re W n /Sh1 sh Q")),
      );
    });
    const before = px(render(gradient, 0), 150, 350);
    session.open(gradient, "");
    const out = session.apply(
      textSettings({ position: "top" }, { fontSize: 30 }),
      [0],
    );
    expect(px(render(out, 0), 150, 350)).toEqual(before);
    // the original stream is still in /Contents, decoded content unchanged
    const doc = await PDFDocument.load(out);
    const contents = doc.getPage(0).node.Contents() as PDFArray;
    const decoded = contents
      .asArray()
      .map((ref) =>
        new TextDecoder().decode(
          decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode(),
        ),
      );
    expect(decoded).toContain("q 0 0 300 100 re W n /Sh1 sh Q");
  });

  it("keeps the password of an encrypted PDF", async () => {
    const encrypted = new Uint8Array(
      readFileSync(
        new URL("../../../../fixtures/user-password.pdf", import.meta.url),
      ),
    );
    expect(() => session.open(encrypted, "")).toThrow(PdfOpenError);
    expect(() => session.open(encrypted, "nope")).toThrow(PdfOpenError);
    session.open(encrypted, "hunter2");
    const out = session.apply(
      textSettings({ position: "tile" }, { fontSize: 30 }),
      [0],
    );
    expect(() => render(out, 0)).toThrow(
      expect.objectContaining({ reason: "password" }),
    );
    const img = render(out, 0, "hunter2");
    expect(redBox(img)).not.toBeNull();
  });

  it("tiles across the page, storing the watermark once per page size", async () => {
    session.open(await letterPdf(4), "");
    const out = session.apply(
      textSettings({ position: "tile", rotation: 45 }, { fontSize: 30 }),
      [0, 1, 2, 3],
    );
    const img = render(out, 0);
    const box = redBox(img)!;
    // copies reach (or are cut off by) all four sides
    expect(box.left).toBeLessThan(60);
    expect(box.top).toBeLessThan(60);
    expect(box.right).toBeGreaterThan(552);
    expect(box.bottom).toBeGreaterThan(732);
    // all four pages reference the same stamp XObject
    const refs = await Promise.all(
      [0, 1, 2, 3].map((i) => pageXObjects(out, i)),
    );
    expect(new Set(refs.flat()).size).toBe(1);
  });

  it("embeds a tiled picture once, at the chosen width", async () => {
    session.open(await letterPdf(2), "");
    const png = makePng(10, 5, () => [255, 0, 0, 255]);
    const settings = (
      position: WatermarkSettings["position"],
    ): WatermarkSettings => ({
      content: {
        kind: "image",
        bytes: png.buffer.slice(
          png.byteOffset,
          png.byteOffset + png.byteLength,
        ) as ArrayBuffer,
        scale: 0.5,
      },
      opacity: 1,
      rotation: 0,
      position,
      layer: "over",
    });
    const centred = session.apply(settings("center"), [0]);
    const box = redBox(render(centred, 0))!;
    expect(box.right - box.left + 1).toBeGreaterThanOrEqual(305);
    expect(box.right - box.left + 1).toBeLessThanOrEqual(307);
    expect(box.bottom - box.top + 1).toBeGreaterThanOrEqual(152);
    expect(box.bottom - box.top + 1).toBeLessThanOrEqual(154);

    const tiled = session.apply(
      {
        ...settings("tile"),
        content: { ...settings("tile").content, scale: 0.1 } as never,
      },
      [0, 1],
    );
    // One picture (plus the soft mask PDFium stores its alpha channel in),
    // however many copies the tiles show.
    const images = await objectsOfSubtype(tiled, "Image");
    const masks = new Set(
      images.map(([, s]) =>
        (s as PDFRawStream).dict.get(PDFName.of("SMask"))?.toString(),
      ),
    );
    const pictures = images.filter(([ref]) => !masks.has(ref.toString()));
    expect(pictures).toHaveLength(1);
    expect(redBox(render(tiled, 1))).not.toBeNull();
  });

  it("tags every copy as an artifact", async () => {
    session.open(await letterPdf(1), "");
    const out = session.apply(
      textSettings({ position: "tile" }, { fontSize: 30 }),
      [0],
    );
    const forms = await objectsOfSubtype(out, "Form");
    const contents = forms.map(([, s]) =>
      new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode()),
    );
    expect(contents.some((c) => c.includes("/Artifact BMC"))).toBe(true);
  });

  it("centres the watermark on each page of a mixed-size PDF", async () => {
    const mixed = await makePdf((doc) => {
      doc.addPage([612, 792]);
      doc.addPage([842, 595]);
    });
    session.open(mixed, "");
    const out = session.apply(textSettings(), [0, 1]);
    expectCentredOn(render(out, 0), 306, 396);
    expectCentredOn(render(out, 1), 421, 297.5);
  });

  it("previews exactly what the download contains", async () => {
    session.open(await letterPdf(2), "");
    const settings = textSettings({ rotation: 30, opacity: 0.4 });
    const preview = session.preview(1, 612, settings);
    const download = render(session.apply(settings, [1]), 1);
    expect([preview.width, preview.height]).toEqual([612, 792]);
    expect(
      Buffer.compare(Buffer.from(preview.pixels), Buffer.from(download.pixels)),
    ).toBe(0);
  });

  it("previews a page without settings as it is", async () => {
    session.open(await letterPdf(1), "");
    const plain = session.preview(0, 306);
    expect([plain.width, plain.height]).toEqual([306, 396]);
    expect(redBox(plain)).toBeNull();
  });

  it("refuses text the standard fonts cannot write, before drawing anything", async () => {
    session.open(await letterPdf(1), "");
    expect(() =>
      session.apply(textSettings({}, { text: "Price ₹5" }), [0]),
    ).toThrow(InvalidSettingsError);
  });
});
