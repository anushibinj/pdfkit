// @vitest-environment node
/**
 * Runs the real PDFium build and the real pdf-crop module (the committed
 * crates/pdf-crop/dist/pdf_crop.wasm) end to end: open, preview, crop with
 * and without removing what lies outside, and the check that refuses a
 * result whose crop area changed.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import {
  extractText,
  loadNodePdfium,
  type FullPdfium,
} from "@/lib/pdfium/test-utils/pdfium-node";
import { buildCropPlan, type CropPlan } from "../core/crop-plan";
import { asCropPdfiumApi, type CropPdfiumApi } from "./crop-pdfium-api";
import {
  CropModuleError,
  CropSession,
  EncryptedPdfError,
} from "./crop-session";
import { CropVerificationError } from "./crop-verifier";
import { PdfCropModule } from "./pdf-crop-module";

const repo = new URL("../../../../", import.meta.url);
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`fixtures/${name}`, repo)));

let full: FullPdfium;
let api: CropPdfiumApi;
let cropModule: PdfCropModule;
/** Page 1: "SECRET" outside the middle, "KEEP" inside, a box outside. */
let simple: Uint8Array;
/**
 * One page with an offset MediaBox (pdf-lib's setMediaBox takes x, y,
 * width, height: the box is 100..700 x 50..450) and /Rotate 90.
 */
let rotated: Uint8Array;

beforeAll(async () => {
  full = await loadNodePdfium();
  api = asCropPdfiumApi(full);
  cropModule = await PdfCropModule.load(
    new URL("crates/pdf-crop/dist/pdf_crop.wasm", repo).href,
    async (url) => {
      const bytes = readFileSync(new URL(url));
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    },
  );
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  page.drawText("SECRET", { x: 10, y: 20, size: 20, font });
  page.drawText("KEEP", { x: 150, y: 200, size: 20, font });
  page.drawRectangle({
    x: 10,
    y: 350,
    width: 30,
    height: 30,
    color: rgb(1, 0, 0),
  });
  page.drawRectangle({
    x: 150,
    y: 150,
    width: 30,
    height: 30,
    color: rgb(0, 0, 1),
  });
  simple = await doc.save();

  const turned = await PDFDocument.create();
  const tfont = await turned.embedFont(StandardFonts.Helvetica);
  const p = turned.addPage([600, 400]);
  p.setMediaBox(100, 50, 600, 400);
  p.setRotation(degrees(90));
  p.drawText("HIDDEN", { x: 600, y: 200, size: 18, font: tfont });
  p.drawText("VISIBLE", { x: 300, y: 250, size: 18, font: tfont });
  rotated = await turned.save();
}, 60_000);

const session = (
  module: () => Promise<PdfCropModule> = async () => cropModule,
) => new CropSession(api, module);

/** Every decompressed stream of a PDF, joined (where removed text must not be). */
function allStreams(pdf: Uint8Array): string {
  const text = Buffer.from(pdf).toString("latin1");
  let out = text;
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = text.indexOf("endstream", start);
    try {
      out += inflateSync(Buffer.from(pdf.subarray(start, end))).toString(
        "latin1",
      );
    } catch {
      // Not Flate (or not a stream): the raw text is already included.
    }
  }
  return out;
}

const middle: CropPlan["pages"][number]["rect"] = {
  left: 100,
  bottom: 100,
  right: 300,
  top: 300,
};

describe("CropSession with the real engines", () => {
  it("opens a file and renders its pages", () => {
    const s = session();
    expect(s.open(simple)).toEqual([
      { box: { left: 0, bottom: 0, right: 400, top: 400 }, rotation: 0 },
    ]);
    const page = s.render(0, 200);
    expect([page.width, page.height]).toEqual([200, 200]);
    expect(page.pixels.length).toBe(200 * 200 * 4);
    s.close();
    expect(() => s.render(0, 100)).toThrow("No PDF is open");
  });

  it("refuses encrypted files, with or without a password", () => {
    for (const name of ["owner-restricted.pdf", "user-password.pdf"]) {
      expect(() => session().open(fixture(name)), name).toThrow(
        EncryptedPdfError,
      );
    }
  });

  it("hiding only sets the crop box: the text outside is still in the file", async () => {
    const s = session();
    s.open(simple);
    const out = await s.crop({
      removeOutside: false,
      pages: [{ pageIndex: 0, rect: middle }],
    });
    expect(out.verified).toBe(false);
    expect(out.report.pagesCropped).toBe(1);
    expect(extractText(full, out.pdf)[0]).toContain("SECRET");
  });

  it("removing deletes what is outside from the file and passes the check", async () => {
    const s = session();
    s.open(simple);
    const stages: string[] = [];
    const out = await s.crop(
      { removeOutside: true, pages: [{ pageIndex: 0, rect: middle }] },
      (stage, fraction) => stages.push(`${stage}:${fraction}`),
    );
    expect(out.verified).toBe(true);
    expect(out.report.glyphsRemoved).toBe(6);
    expect(out.report.pathsRemoved).toBe(1);
    const text = extractText(full, out.pdf)[0];
    expect(text).toContain("KEEP");
    expect(text).not.toContain("SECRET");
    expect(allStreams(out.pdf)).not.toContain("SECRET");
    expect(stages).toEqual([
      "cropping:0",
      "cropping:1",
      "checking:0",
      "checking:1",
    ]);
  });

  it("handles a rotated page with an offset box, margins taken as displayed", async () => {
    const s = session();
    const pages = s.open(rotated);
    // Displayed 400 wide (the box's height) and 600 tall; cut 150 from the
    // displayed bottom, which on this page is the box's right side.
    const built = buildCropPlan(
      pages,
      [0],
      { top: 0, right: 0, bottom: 150, left: 0 },
      true,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.pages[0].rect).toEqual({
      left: 100,
      bottom: 50,
      right: 550,
      top: 450,
    });
    const out = await s.crop(built.plan);
    const text = extractText(full, out.pdf)[0];
    expect(text).toContain("VISIBLE");
    expect(text).not.toContain("HIDDEN");
  });

  it("passes the check on real-world text with subset fonts (Chromium output)", async () => {
    const s = session();
    const [info] = s.open(fixture("text-chromium.pdf"));
    const { left, bottom, right, top } = info.box;
    const rect = {
      left: left + (right - left) * 0.25,
      bottom: bottom + (top - bottom) * 0.3,
      right: left + (right - left) * 0.8,
      top: bottom + (top - bottom) * 0.75,
    };
    const out = await s.crop({
      removeOutside: true,
      pages: [{ pageIndex: 0, rect }],
    });
    expect(out.verified).toBe(true);
    expect(out.report.glyphsRemoved).toBeGreaterThan(0);
    // Chromium writes fractional widths, which PDFium truncates.
    expect(out.report.maxTextShift).toBeGreaterThan(0);
  });

  it("refuses a result whose crop area changed", async () => {
    // A sabotaged module: it removes what lies outside a smaller area than
    // the plan asks for, so visible text inside the crop area disappears.
    const sabotaged = {
      crop: (pdf: Uint8Array) =>
        cropModule.crop(
          pdf,
          new Uint8Array(
            new Float64Array([1, 1, 1, 0, 100, 100, 160, 300]).buffer,
          ),
        ),
    } as unknown as PdfCropModule;
    const s = session(async () => sabotaged);
    s.open(simple);
    await expect(
      s.crop({ removeOutside: true, pages: [{ pageIndex: 0, rect: middle }] }),
    ).rejects.toThrow(CropVerificationError);
  });

  it("passes on the module's own errors", async () => {
    const failing = {
      crop: () => ({ ok: false, code: "unreadable", message: "Broken." }),
    } as unknown as PdfCropModule;
    const s = session(async () => failing);
    s.open(simple);
    const error = await s
      .crop({ removeOutside: false, pages: [{ pageIndex: 0, rect: middle }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CropModuleError);
    expect((error as CropModuleError).code).toBe("unreadable");
  });
});
