// @vitest-environment node
/**
 * Runs the real PDFium WebAssembly build: sizes and pixels of drawn pages,
 * including a page with its own /Rotate, and an encrypted file.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { readFileSync } from "node:fs";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/pdfium-node";
import { asPreviewApi } from "../worker/load-pdfium";
import { PreviewSession } from "./preview-session";

let pdfium: WrappedPdfiumModule;
/**
 * Page 1: 600 x 400, a black square at the bottom-left corner.
 * Page 2: 600 x 400 with /Rotate 90, so it is shown 400 wide, 600 tall;
 * its black square (bottom-left on paper) shows at the top-left.
 */
let fixture: Uint8Array;

beforeAll(async () => {
  pdfium = await loadNodePdfiumModule();
  const doc = await PDFDocument.create();
  for (const rotate of [0, 90]) {
    const page = doc.addPage([600, 400]);
    page.setRotation(degrees(rotate));
    page.drawRectangle({ x: 0, y: 0, width: 60, height: 60, color: rgb(0, 0, 0) });
  }
  fixture = await doc.save();
}, 60_000);

/** RGB of one pixel of a drawn page. */
function pixel(page: { width: number; pixels: Uint8Array }, x: number, y: number) {
  const o = (y * page.width + x) * 4;
  return [page.pixels[o], page.pixels[o + 1], page.pixels[o + 2]];
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

describe("PreviewSession with the real PDFium", () => {
  it("reports shown sizes, with the page's own rotation applied", () => {
    const session = new PreviewSession(asPreviewApi(pdfium));
    expect(session.open(fixture, "")).toEqual([
      { width: 600, height: 400 },
      { width: 400, height: 600 },
    ]);
    session.close();
  });

  it("draws pages upright at the thumbnail size", () => {
    const session = new PreviewSession(asPreviewApi(pdfium));
    session.open(fixture, "");

    const flat = session.render(0, 300);
    expect([flat.width, flat.height]).toEqual([300, 200]);
    expect(flat.pixels.length).toBe(300 * 200 * 4);
    expect(pixel(flat, 5, 195)).toEqual(BLACK); // bottom-left
    expect(pixel(flat, 295, 5)).toEqual(WHITE); // top-right

    const turned = session.render(1, 200);
    expect([turned.width, turned.height]).toEqual([200, 300]);
    expect(pixel(turned, 5, 5)).toEqual(BLACK); // the square, turned
    expect(pixel(turned, 195, 295)).toEqual(WHITE);
    session.close();
  });

  it("needs the password of an encrypted file", () => {
    const session = new PreviewSession(asPreviewApi(pdfium));
    const locked = new Uint8Array(
      readFileSync(new URL("../../../../fixtures/user-password.pdf", import.meta.url)),
    );
    expect(() => session.open(locked, "")).toThrow(
      expect.objectContaining({ reason: "password" }),
    );
    expect(() => session.open(locked, "wrong")).toThrow(PdfOpenError);
    expect(session.open(locked, "hunter2")).toHaveLength(1);
    expect(session.render(0, 100).width).toBe(100);
    session.close();
  });
});
