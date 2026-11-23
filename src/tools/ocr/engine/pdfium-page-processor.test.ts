// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import { asOcrPdfiumApi } from "./pdfium-api";
import {
  isPasswordPdfiumCode,
  PdfiumPageProcessor,
} from "./pdfium-page-processor";
import { FPDF_ERR } from "@/lib/pdfium/core-api";

let processor: PdfiumPageProcessor;

beforeAll(async () => {
  const full = await loadNodePdfiumModule();
  processor = new PdfiumPageProcessor(asOcrPdfiumApi(full));
});

describe("PdfiumPageProcessor (real PDFium WASM)", () => {
  it("converts a PNG image into a 1-page PDF and leaves PDF inputs untouched", async () => {
    const png = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const fromImg = processor.ensurePdfBytes(new Uint8Array(png));
    expect(fromImg.wasImageInput).toBe(true);
    expect(new TextDecoder().decode(fromImg.pdfBytes.slice(0, 5))).toBe("%PDF-");

    const inspected = processor.inspectPages(fromImg.pdfBytes, "");
    expect(inspected).toHaveLength(1);
    expect(inspected[0].hasExistingText).toBe(false);
    expect(Math.round(inspected[0].placementSize.width)).toBe(120);
    expect(Math.round(inspected[0].placementSize.height)).toBe(80);

    const pdfSample = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    const fromPdf = processor.ensurePdfBytes(pdfSample);
    expect(fromPdf.wasImageInput).toBe(false);
    expect(fromPdf.pdfBytes).toBe(pdfSample);
  });

  it("detects pages with existing text vs image-only pages and renders at target DPI", async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([200, 100]);
    p1.drawText("Already searchable", { x: 20, y: 50, size: 12 });
    doc.addPage([200, 100]); // blank / image-only page
    const pdfBytes = await doc.save();

    const inspected = processor.inspectPages(pdfBytes, "");
    expect(inspected).toHaveLength(2);
    expect(inspected[0].hasExistingText).toBe(true);
    expect(inspected[0].existingText).toContain("Already searchable");
    expect(inspected[1].hasExistingText).toBe(false);

    const rendered = processor.renderPageForOcr(pdfBytes, "", 1, 150);
    // 200 pt * 150 / 72 = 417 px, height = Math.round(417 * 0.5) = 209 px
    expect(rendered.width).toBe(417);
    expect(rendered.height).toBe(209);
    expect(rendered.effectiveDpiX).toBe(150);
    expect(rendered.pixels.length).toBe(rendered.width * rendered.height * 4);
  });

  it("identifies password PDFium error codes", () => {
    expect(isPasswordPdfiumCode(FPDF_ERR.PASSWORD)).toBe(true);
    expect(isPasswordPdfiumCode(FPDF_ERR.FORMAT)).toBe(false);
  });
});
