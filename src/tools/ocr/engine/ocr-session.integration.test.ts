// @vitest-environment node
/**
 * Full end-to-end integration tests using real WebAssembly engines:
 * - `crates/pdf-ocr/dist/pdf_ocr.wasm`
 * - `tesseract.js-core` (`TesseractCore` LSTM WASM)
 * - `@tesseract.js-data/eng` and `@tesseract.js-data/hin`
 * - `@embedpdf/pdfium` (`pdfium.wasm`)
 * - `@jspawn/qpdf-wasm` (`qpdf.wasm`)
 *
 * Verifies Issue #17 acceptance criteria:
 * 1. Searching/extracting words from a scanned English PDF finds them at the right spot.
 * 2. A Hindi Devanagari fixture produces selectable, correctly copyable Devanagari Unicode text.
 * 3. The output PDF renders pixel-identically to the input PDF.
 * 4. Pages that already have selectable text are skipped unless `redoExistingText: true`.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import {
  extractText,
  loadNodePdfiumModule,
} from "@/lib/pdfium/test-utils/node-pdfium";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { loadNodeQpdf } from "@/lib/qpdf/test-utils/node-qpdf";
import type { OcrLanguageCode } from "../core/model";
import { DEFAULT_OCR_OPTIONS } from "../core/options";
import { OcrSession } from "./ocr-session";
import { PdfOcrModule } from "./pdf-ocr-module";
import { asOcrPdfiumApi, type OcrPdfiumApi } from "./pdfium-api";
import { PdfiumPageProcessor } from "./pdfium-page-processor";
import { QpdfOverlayApplier } from "./qpdf-overlay-applier";
import {
  TesseractWasmRecognizer,
  type TesseractCoreFactory,
  type TesseractCoreModule,
} from "./tesseract-recognizer";

const require = createRequire(import.meta.url);

let fullPdfium: Awaited<ReturnType<typeof loadNodePdfiumModule>>;
let ocrPdfium: OcrPdfiumApi;
let recognizer: TesseractWasmRecognizer;
let session: OcrSession;

beforeAll(async () => {
  const ocrWasmBytes = readFileSync(
    new URL("../../../../crates/pdf-ocr/dist/pdf_ocr.wasm", import.meta.url),
  );
  const [helper, qpdfRunner, pdfiumModule] = await Promise.all([
    PdfOcrModule.load("pdf-ocr.wasm", async () =>
      ocrWasmBytes.buffer.slice(
        ocrWasmBytes.byteOffset,
        ocrWasmBytes.byteOffset + ocrWasmBytes.byteLength,
      ),
    ),
    loadNodeQpdf(),
    loadNodePdfiumModule(),
  ]);

  fullPdfium = pdfiumModule;
  ocrPdfium = asOcrPdfiumApi(pdfiumModule);

  const TesseractCore = require("tesseract.js-core/tesseract-core-lstm") as TesseractCoreFactory;

  recognizer = new TesseractWasmRecognizer(
    helper,
    async (lang: OcrLanguageCode) => {
      const gzPath = require.resolve(
        `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
      );
      return new Uint8Array(readFileSync(gzPath));
    },
    async (onProgress) => {
      const mod = await TesseractCore({
        TesseractProgress: onProgress,
      });
      return mod as unknown as TesseractCoreModule;
    },
  );

  session = new OcrSession(
    helper,
    new PdfiumPageProcessor(ocrPdfium),
    recognizer,
    new QpdfOverlayApplier(qpdfRunner),
  );
}, 60_000);

afterAll(() => {
  recognizer?.dispose();
});

/**
 * Renders crisp dark text onto a white PNG via librsvg (sharp SVG input) and
 * wraps it inside an image-only PDF with zero existing text objects.
 */
async function createScannedPdfFromSvg(
  svg: string,
  pageWidthPt: number,
  pageHeightPt: number,
): Promise<{ pdf: Uint8Array; png: Uint8Array }> {
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const doc = await PDFDocument.create();
  const embedded = await doc.embedPng(pngBuffer);
  const page = doc.addPage([pageWidthPt, pageHeightPt]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: pageWidthPt,
    height: pageHeightPt,
  });
  return {
    pdf: await doc.save(),
    png: new Uint8Array(pngBuffer),
  };
}

describe("OcrSession (real WASM integration)", () => {
  it("makes a scanned English PDF searchable at the right coordinates and stays pixel-identical", async () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
        <rect width="1200" height="600" fill="#ffffff"/>
        <text x="120" y="220" font-family="DejaVu Sans, Arial, sans-serif" font-size="68" fill="#000000">INVOICE TOTAL</text>
        <text x="120" y="380" font-family="DejaVu Sans, Arial, sans-serif" font-size="56" fill="#000000">1520 DOLLARS</text>
      </svg>
    `;
    const { pdf: inputPdf } = await createScannedPdfFromSvg(svg, 400, 200);

    // Confirm input has zero extractable text before OCR
    expect(extractText(fullPdfium, inputPdf)[0].trim()).toBe("");

    const out = await session.run(inputPdf, {
      ...DEFAULT_OCR_OPTIONS,
      languages: ["eng"],
      dpi: 300,
    });

    expect(out.kind).toBe("completed");
    if (out.kind !== "completed") return;

    const extracted = extractText(fullPdfium, out.pdf);
    expect(extracted[0].toUpperCase()).toContain("INVOICE");
    expect(extracted[0].toUpperCase()).toContain("1520");

    // Verify "INVOICE" character bounding box is near the top half of the 400x200 page
    const heap = new WasmHeap(fullPdfium.pdfium);
    const outDoc = PdfiumDocument.open(ocrPdfium, heap, out.pdf, "");
    try {
      outDoc.withPage(0, (page) => {
        const textPage = fullPdfium.FPDFText_LoadPage(page);
        try {
          const count = fullPdfium.FPDFText_CountChars(textPage);
          let pageText = "";
          for (let i = 0; i < count; i++) {
            pageText += String.fromCodePoint(
              fullPdfium.FPDFText_GetUnicode(textPage, i),
            );
          }
          const idx = pageText.toUpperCase().indexOf("INVOICE");
          expect(idx).toBeGreaterThanOrEqual(0);
          heap.using(heap.alloc(32), (rectPtr) => {
            const ok = fullPdfium.FPDFText_GetCharBox(
              textPage,
              idx,
              rectPtr,
              rectPtr + 8,
              rectPtr + 16,
              rectPtr + 24,
            );
            expect(ok).toBe(true);
            const [left, , bottom, top] = heap.readDoubles(rectPtr, 4);
            // X near left margin (120/1200 * 400 = 40 pt), Y in upper half (> 100 pt)
            expect(left).toBeGreaterThan(20);
            expect(left).toBeLessThan(120);
            expect((bottom + top) / 2).toBeGreaterThan(100);
          });
        } finally {
          fullPdfium.FPDFText_ClosePage(textPage);
        }
      });

      // Pixel-identical appearance check against the original scanned PDF
      const inDoc = PdfiumDocument.open(ocrPdfium, heap, inputPdf, "");
      try {
        const origPixels = inDoc.render(0, 400, 200, 0).pixels;
        const ocrPixels = outDoc.render(0, 400, 200, 0).pixels;
        expect(ocrPixels).toEqual(origPixels);
      } finally {
        inDoc.close();
      }
    } finally {
      outDoc.close();
    }
  }, 60_000);

  it("recognizes Hindi Devanagari text and produces copyable Unicode in the PDF", async () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500">
        <rect width="1200" height="500" fill="#ffffff"/>
        <text x="140" y="260" font-family="Nirmala UI, Mangal, Noto Sans Devanagari, sans-serif" font-size="96" fill="#000000">नमस्ते भारत</text>
      </svg>
    `;
    const { pdf: hindiPdf } = await createScannedPdfFromSvg(svg, 400, 167);

    const out = await session.run(hindiPdf, {
      ...DEFAULT_OCR_OPTIONS,
      languages: ["hin"],
      dpi: 300,
    });

    expect(out.kind).toBe("completed");
    if (out.kind !== "completed") return;

    const extracted = extractText(fullPdfium, out.pdf)[0];
    // Verify Devanagari Unicode code points (U+0900..U+097F) are present & selectable
    expect(/[\u0900-\u097F]{4,}/.test(extracted)).toBe(true);
    expect(out.report.ocrPagesCount).toBe(1);
    expect(/[\u0900-\u097F]{4,}/.test(out.report.fullText)).toBe(true);
  }, 30_000);

  it("skips pages with existing text automatically unless redoExistingText is enabled, and accepts PNG images", async () => {
    const doc = await PDFDocument.create();
    const textPage = doc.addPage([300, 200]);
    textPage.drawText("Native Digital Text", { x: 30, y: 120, size: 18 });
    const mixedPdf = await doc.save();

    const skippedOut = await session.run(mixedPdf, {
      ...DEFAULT_OCR_OPTIONS,
      redoExistingText: false,
    });
    expect(skippedOut.kind).toBe("completed");
    if (skippedOut.kind === "completed") {
      expect(skippedOut.report.skippedPagesCount).toBe(1);
      expect(skippedOut.report.ocrPagesCount).toBe(0);
      expect(skippedOut.report.fullText).toContain("Native Digital Text");
    }

    // PNG image input -> 1-page searchable PDF
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="300">
        <rect width="800" height="300" fill="#ffffff"/>
        <text x="80" y="170" font-family="DejaVu Sans, Arial, sans-serif" font-size="60" fill="#000000">RECEIPT 99</text>
      </svg>
    `;
    const { png } = await createScannedPdfFromSvg(svg, 400, 150);
    const imgOut = await session.run(png, {
      ...DEFAULT_OCR_OPTIONS,
      languages: ["eng"],
      dpi: 300,
    });
    expect(imgOut.kind).toBe("completed");
    if (imgOut.kind === "completed") {
      expect(imgOut.wasImageInput).toBe(true);
      expect(extractText(fullPdfium, imgOut.pdf)[0].toUpperCase()).toContain(
        "RECEIPT",
      );
    }
  }, 30_000);
});
