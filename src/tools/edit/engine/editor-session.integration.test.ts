// @vitest-environment node
/**
 * Runs the real PDFium WebAssembly build end to end.
 *
 * Objects are placed exactly as the UI places them (with the core gesture
 * and geometry functions, in view coordinates), saved, rendered again by
 * PDFium and checked pixel by pixel at the positions the on-screen overlay
 * would draw them. That ties the preview math to what lands in the file,
 * including on a page that is both rotated and offset.
 */
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { applyToPoint } from "../core/affine";
import {
  DEFAULT_TOOL_STYLE,
  boxFromDrag,
  createImageObject,
  createTextObject,
  finishGesture,
  startInk,
  updateGesture,
  type GesturePage,
} from "../core/gestures";
import type { EditObject, PageInfo } from "../core/model";
import { localBounds } from "../core/object-bounds";
import { addTurns, userToView, viewSize } from "../core/page-geometry";
import type { SavePlan } from "../core/save-plan";
import { InvalidPlanError } from "../core/sanitize-plan";
import { StandardFontMetricsSource } from "../core/standard-font-metrics";
import { lineWidth } from "../core/text-layout";
import { GREEN_JPEG, makePng } from "../test-utils/images";
import {
  extractText,
  loadNodePdfium,
  pixelAt,
  toArrayBuffer,
  type FullPdfium,
} from "../test-utils/pdfium-node";
import { EditorSession, MAX_RENDER_WIDTH } from "./editor-session";
import type { PdfiumApi } from "./pdfium-api";
import { PdfOpenError, PdfiumDocument } from "./pdfium-document";
import { WasmHeap } from "./wasm-heap";
import { WhiteoutWriter } from "./writers/box-writers";

let api: PdfiumApi;
let full: FullPdfium;
const metrics = new StandardFontMetricsSource();
const style = { ...DEFAULT_TOOL_STYLE, color: { r: 0, g: 0, b: 255 } };
const fixturePath = (name: string) =>
  new URL(`../../../../fixtures/${name}`, import.meta.url);

/**
 * Three pages. Page 1 is the hard case: its MediaBox starts at (100, 50)
 * and it has /Rotate 90, so it shows 400 wide and 600 tall. It has a black
 * square near the top-left corner of the unrotated page and one line of
 * text. Pages 2 and 3 only carry a label.
 */
let fixture: Uint8Array;
/** Page 1's box and rotation, and the page as the UI's gestures see it. */
let info1: PageInfo;
let page1: GesturePage;

beforeAll(async () => {
  ({ api, full } = await loadNodePdfium());
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([600, 400]);
  p1.setMediaBox(100, 50, 600, 400);
  p1.setRotation(degrees(90));
  p1.drawRectangle({
    x: 110,
    y: 400,
    width: 40,
    height: 40,
    color: rgb(0, 0, 0),
  });
  p1.drawText("ORIGINAL LINE", { x: 200, y: 300, size: 24, font });
  for (const label of ["SECOND", "THIRD"]) {
    doc.addPage([600, 400]).drawText(label, { x: 50, y: 300, size: 24, font });
  }
  fixture = await doc.save();
  const probe = new EditorSession(api, metrics);
  info1 = probe.open(fixture, "")[0];
  probe.close();
  page1 = { box: info1.box, turns: info1.rotation };
}, 60_000);

const session = () => new EditorSession(api, metrics);

/** Open `bytes` and render page `index` at one pixel per point. */
function render(bytes: Uint8Array, index: number, password = "") {
  const s = session();
  const info = s.open(bytes, password)[index];
  const view = viewSize(info.box, info.rotation);
  const img = s.render(index, 0, view.width);
  s.close();
  return { ...img, info };
}

/** Save `objects` on page 1 of the fixture (other pages untouched). */
function saveOnFirstPage(
  objects: EditObject[],
  images: SavePlan["images"] = [],
) {
  const s = session();
  s.open(fixture, "");
  const out = s.save({
    pages: [
      { sourceIndex: 0, rotation: 0, objects },
      { sourceIndex: 1, rotation: 0, objects: [] },
      { sourceIndex: 2, rotation: 0, objects: [] },
    ],
    images,
  });
  s.close();
  return out;
}

const isDark = ([r, g, b]: number[]) => r < 100 && g < 100 && b < 100;
const near = (actual: number[], expected: number[], tolerance = 6) =>
  actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

describe("EditorSession with the real PDFium build", () => {
  it("reads every page's box and rotation", () => {
    const pages = session().open(fixture, "");
    expect(pages).toHaveLength(3);
    expect(pages[0]).toEqual({
      box: { left: 100, bottom: 50, right: 700, top: 450 },
      rotation: 1,
    });
    expect(pages[1]).toEqual({
      box: { left: 0, bottom: 0, right: 600, top: 400 },
      rotation: 0,
    });
  });

  it("renders a rotated, offset page where userToView predicts", () => {
    const img = render(fixture, 0);
    expect([img.width, img.height]).toEqual([400, 600]);
    // centre of the black square, user (130, 420)
    const c = applyToPoint(userToView(info1.box, 1), { x: 130, y: 420 });
    expect(c).toEqual({ x: 370, y: 30 }); // top-right of the displayed page
    expect(isDark(pixelAt(img, c.x, c.y))).toBe(true);
    expect(pixelAt(img, 30, 30)).toEqual([255, 255, 255]);
  });

  it("applies extra user turns when rendering", () => {
    const s = session();
    s.open(fixture, "");
    const img = s.render(1, 1, 400); // page 2 turned clockwise: 400 x 600
    expect([img.width, img.height]).toEqual([400, 600]);
    expect(() => s.render(7, 0, 100)).toThrow("There is no page 8");
    s.close();
    expect(() => s.render(0, 0, 100)).toThrow("No PDF is open");
  });

  it("caps the render width", () => {
    const s = session();
    s.open(fixture, "");
    expect(s.render(1, 0, 100_000).width).toBe(MAX_RENDER_WIDTH);
    s.close();
  });

  it("writes text that can be selected and sits where the preview shows it", () => {
    const text = {
      ...createTextObject("t", { x: 40, y: 120 }, page1, style),
      text: "Hello",
      fontSize: 30,
    };
    const out = saveOnFirstPage([text]);
    expect(extractText(full, out)[0]).toContain("Hello");
    const img = render(out, 0);
    const b = localBounds(text, metrics);
    let dark = 0;
    for (let y = 120; y < 120 + b.height; y++)
      for (let x = 40; x < 40 + b.width; x++)
        if (isDark(pixelAt(img, x, y))) dark++;
    expect(dark).toBeGreaterThan(50);
    // nothing just outside the predicted block
    for (let y = 120; y < 120 + b.height; y++)
      expect(pixelAt(img, 36, y)).toEqual([255, 255, 255]);
  });

  it("writes multi-line text in serif and mono fonts", () => {
    const base = createTextObject("t", { x: 40, y: 200 }, page1, style);
    const out = saveOnFirstPage([
      { ...base, text: "Line one\nLine two", font: "serif" },
      { ...base, id: "m", y: base.y + 100, text: "Mono", font: "mono" },
    ]);
    const text = extractText(full, out)[0];
    expect(text).toContain("Line one");
    expect(text).toContain("Line two");
    expect(text).toContain("Mono");
    const fonts = Buffer.from(out).toString("latin1");
    expect(fonts).toContain("/Times-Roman");
    expect(fonts).toContain("/Courier");
  });

  it("removes characters the standard fonts cannot write", () => {
    const text = {
      ...createTextObject("t", { x: 40, y: 300 }, page1, style),
      text: "Price ₹5",
    };
    expect(extractText(full, saveOnFirstPage([text]))[0]).toContain("Price 5");
  });

  it("draws an outlined rectangle", () => {
    const rect = boxFromDrag(
      "r",
      "rect",
      { x: 50, y: 300 },
      { x: 250, y: 400 },
      page1,
      {
        ...style,
        color: { r: 255, g: 0, b: 0 },
        strokeWidth: 4,
      },
    );
    const img = render(saveOnFirstPage([rect]), 0);
    expect(near(pixelAt(img, 50, 350), [255, 0, 0], 40)).toBe(true);
    expect(near(pixelAt(img, 150, 300), [255, 0, 0], 40)).toBe(true);
    expect(pixelAt(img, 150, 350)).toEqual([255, 255, 255]);
  });

  it("blends highlights like a marker: tinted paper, black stays black", () => {
    const over = (
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => boxFromDrag("h", "highlight", from, to, page1, style);
    // blank paper, and the black square (view 350..390 x 10..50)
    const out = saveOnFirstPage([
      over({ x: 50, y: 450 }, { x: 250, y: 480 }),
      over({ x: 340, y: 5 }, { x: 395, y: 55 }),
    ]);
    const img = render(out, 0);
    // 40% of (255, 224, 51) multiplied over white
    expect(near(pixelAt(img, 150, 465), [255, 243, 173])).toBe(true);
    expect(isDark(pixelAt(img, 370, 30))).toBe(true);
  });

  it("draws freehand strokes along the pointer path", () => {
    let g = startInk({ x: 300, y: 100 }, page1);
    g = updateGesture(g, { x: 350, y: 100 }, page1);
    g = updateGesture(g, { x: 350, y: 150 }, page1);
    const done = finishGesture(g, page1, { ...style, strokeWidth: 4 }, "ink");
    if (done?.type !== "add") throw new Error("unreachable");
    const img = render(saveOnFirstPage([done.object]), 0);
    expect(near(pixelAt(img, 325, 100), [0, 0, 255], 30)).toBe(true);
    expect(near(pixelAt(img, 350, 125), [0, 0, 255], 30)).toBe(true);
    expect(pixelAt(img, 325, 125)).toEqual([255, 255, 255]);
  });

  it("embeds PNGs with transparency and JPEGs", () => {
    // left half opaque red, right half fully transparent
    const png = makePng(20, 20, (x) =>
      x < 10 ? [255, 0, 0, 255] : [0, 0, 0, 0],
    );
    const overSquare = {
      ...createImageObject("p", { x: 350, y: 10 }, page1, {
        id: "png",
        pixelWidth: 20,
        pixelHeight: 20,
      }),
      width: 40,
      height: 40,
    };
    const jpeg = {
      ...createImageObject("j", { x: 100, y: 500 }, page1, {
        id: "jpg",
        pixelWidth: 8,
        pixelHeight: 8,
      }),
      width: 40,
      height: 40,
    };
    const out = saveOnFirstPage(
      [overSquare, jpeg],
      [
        { id: "png", mime: "image/png", bytes: toArrayBuffer(png) },
        { id: "jpg", mime: "image/jpeg", bytes: toArrayBuffer(GREEN_JPEG) },
      ],
    );
    const img = render(out, 0);
    expect(near(pixelAt(img, 360, 30), [255, 0, 0])).toBe(true);
    expect(isDark(pixelAt(img, 380, 30))).toBe(true); // the square shows through
    expect(near(pixelAt(img, 120, 520), [0, 200, 0], 12)).toBe(true);
  });

  it("refuses image bytes it cannot decode", () => {
    const img = createImageObject("p", { x: 10, y: 10 }, page1, {
      id: "bad",
      pixelWidth: 1,
      pixelHeight: 1,
    });
    expect(() =>
      saveOnFirstPage(
        [img],
        [
          {
            id: "bad",
            mime: "image/png",
            bytes: new Uint8Array([1, 2, 3]).buffer,
          },
        ],
      ),
    ).toThrow("could not be read");
  });

  it("white-out deletes only the covered word and keeps text placed on top", () => {
    // "ORIGINAL LINE" starts at user (200, 300); on the rotated page it runs
    // down the screen at view x 245..275, from view y 100.
    const helvetica = metrics.metrics("sans");
    const wordEnd = 100 + lineWidth("ORIGINAL", helvetica, 24);
    const whiteout = boxFromDrag(
      "w",
      "whiteout",
      { x: 238, y: 96 },
      { x: 278, y: wordEnd + 2 },
      page1,
      style,
    );
    const replacement = {
      ...createTextObject("n", { x: 40, y: 400 }, page1, style),
      text: "NEW",
    };
    const out = saveOnFirstPage([whiteout, replacement]);
    const text = extractText(full, out)[0];
    expect(text).not.toContain("ORIGINAL");
    expect(text).toContain("LINE");
    expect(text).toContain("NEW");
  });

  it("white-out rewrites image pixels under it, not just covers them", async () => {
    const doc = await PDFDocument.create();
    const grey = await doc.embedPng(
      makePng(60, 40, () => [128, 128, 128, 255]),
    );
    doc
      .addPage([600, 400])
      .drawImage(grey, { x: 0, y: 0, width: 600, height: 400 });
    const s = session();
    const [info] = s.open(await doc.save(), "");
    const page = { box: info.box, turns: info.rotation };
    const out = s.save({
      pages: [
        {
          sourceIndex: 0,
          rotation: 0,
          objects: [
            boxFromDrag(
              "w",
              "whiteout",
              { x: 0, y: 0 },
              { x: 100, y: 100 },
              page,
              style,
            ),
          ],
        },
      ],
      images: [],
    });
    s.close();
    // Inspect the image object's own pixels, not the rendered page.
    const { pdfium } = full;
    const ptr = pdfium.wasmExports.malloc(out.length);
    pdfium.HEAPU8.set(out, ptr);
    const d = full.FPDF_LoadMemDocument(ptr, out.length, "");
    const p = full.FPDF_LoadPage(d, 0);
    let checked = false;
    for (let i = 0; i < full.FPDFPage_CountObjects(p); i++) {
      const obj = full.FPDFPage_GetObject(p, i);
      if (full.FPDFPageObj_GetType(obj) !== 3) continue; // 3 = image
      const bmp = full.FPDFImageObj_GetBitmap(obj);
      const stride = full.FPDFBitmap_GetStride(bmp);
      const bpp = full.FPDFBitmap_GetFormat(bmp) === 2 ? 3 : 4;
      const at = (x: number, y: number) =>
        pdfium.HEAPU8[full.FPDFBitmap_GetBuffer(bmp) + y * stride + x * bpp];
      // image pixel (5, 5) is under the box (page 0..100 x 0..100), (50, 30) is not
      expect(at(5, 5)).toBe(255);
      expect(at(50, 30)).toBe(128);
      full.FPDFBitmap_Destroy(bmp);
      checked = true;
    }
    expect(checked).toBe(true);
    full.FPDF_ClosePage(p);
    full.FPDF_CloseDocument(d);
    pdfium.wasmExports.free(ptr);
  });

  it("white-out's redaction alone also clears vector drawings under it", async () => {
    // Only the prepare pass (no white box painted): what remains is what the
    // redaction itself left in the file.
    const heap = new WasmHeap(api.pdfium);
    const doc = PdfiumDocument.open(api, heap, fixture, "");
    const writer = new WhiteoutWriter();
    // view 340..395 x 5..55 covers the black square
    const box = boxFromDrag(
      "w",
      "whiteout",
      { x: 340, y: 5 },
      { x: 395, y: 55 },
      page1,
      style,
    );
    if (box.kind !== "whiteout") throw new Error("unreachable");
    doc.withPage(0, (page) => {
      writer.prepare(box, {
        api,
        heap,
        doc: doc.handle,
        page,
        images: new Map(),
      });
      api.FPDFPage_GenerateContent(page);
    });
    const out = doc.save();
    doc.close();
    expect(pixelAt(render(out, 0), 370, 30)).toEqual([255, 255, 255]);
  });

  it("rotates, deletes and reorders pages", () => {
    const s = session();
    s.open(fixture, "");
    const out = s.save({
      pages: [
        { sourceIndex: 2, rotation: 1, objects: [] },
        { sourceIndex: 0, rotation: 3, objects: [] },
      ],
      images: [],
    });
    s.close();
    const text = extractText(full, out);
    expect(text).toHaveLength(2);
    expect(text[0]).toContain("THIRD");
    expect(text[1]).toContain("ORIGINAL");
    const pages = session().open(out, "");
    expect(pages[0].rotation).toBe(1);
    expect(pages[1].rotation).toBe(addTurns(1, 3)); // its own 90 plus 270
  });

  it("keeps the order when nothing moves and draws on the right source page", () => {
    const s = session();
    s.open(fixture, "");
    const label = {
      ...createTextObject(
        "t",
        { x: 10, y: 10 },
        { box: { left: 0, bottom: 0, right: 600, top: 400 }, turns: 0 },
        style,
      ),
      text: "ONTHIRD",
    };
    const out = s.save({
      pages: [
        { sourceIndex: 0, rotation: 0, objects: [] },
        { sourceIndex: 2, rotation: 0, objects: [label] },
      ],
      images: [],
    });
    s.close();
    const text = extractText(full, out);
    expect(text[0]).toContain("ORIGINAL");
    expect(text[1]).toContain("THIRD");
    expect(text[1]).toContain("ONTHIRD");
  });

  it("saving twice gives the same edits once, from the original file", () => {
    const s = session();
    s.open(fixture, "");
    const plan = {
      pages: [0, 1, 2].map((i) => ({
        sourceIndex: i,
        rotation: 0,
        objects:
          i === 1
            ? [
                {
                  ...createTextObject(
                    "t",
                    { x: 5, y: 5 },
                    {
                      box: { left: 0, bottom: 0, right: 600, top: 400 },
                      turns: 0,
                    },
                    style,
                  ),
                  text: "ONCE",
                },
              ]
            : [],
      })),
      images: [],
    };
    const first = extractText(full, s.save(plan))[1];
    const second = extractText(full, s.save(plan))[1];
    s.close();
    expect(first.match(/ONCE/g)).toHaveLength(1);
    expect(second).toBe(first);
  });

  it("rejects a plan whose page list does not fit the file", () => {
    const s = session();
    s.open(fixture, "");
    expect(() =>
      s.save({
        pages: [{ sourceIndex: 5, rotation: 0, objects: [] }],
        images: [],
      }),
    ).toThrow(InvalidPlanError);
    s.close();
  });

  it("asks for passwords and keeps the file encrypted after editing", () => {
    const locked = new Uint8Array(
      readFileSync(fixturePath("user-password.pdf")),
    );
    const s = session();
    expect(() => s.open(locked, "")).toThrow(
      expect.objectContaining({ reason: "password" }),
    );
    expect(() => s.open(locked, "wrong")).toThrow(PdfOpenError);
    const [info] = s.open(locked, "hunter2");
    const page = { box: info.box, turns: info.rotation };
    const out = s.save({
      pages: [
        {
          sourceIndex: 0,
          rotation: 0,
          objects: [
            {
              ...createTextObject("t", { x: 20, y: 20 }, page, style),
              text: "EDITED",
            },
          ],
        },
      ],
      images: [],
    });
    s.close();
    expect(() => session().open(out, "")).toThrow(
      expect.objectContaining({ reason: "password" }),
    );
    expect(extractText(full, out, "hunter2")[0]).toContain("EDITED");
  });

  it("opens owner-restricted and signed files, and rejects junk", () => {
    for (const name of ["owner-restricted.pdf", "signed.pdf", "plain.pdf"]) {
      const s = session();
      expect(
        s.open(new Uint8Array(readFileSync(fixturePath(name))), "").length,
      ).toBeGreaterThan(0);
      expect(s.isOpen()).toBe(true);
      s.close();
      expect(s.isOpen()).toBe(false);
    }
    expect(() => session().open(new Uint8Array([1, 2, 3, 4]), "")).toThrow(
      expect.objectContaining({ reason: "format" }),
    );
  });
});
