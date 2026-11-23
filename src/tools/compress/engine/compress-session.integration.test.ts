// @vitest-environment node
/**
 * End-to-end integration tests running the real `pdf-compress.wasm`, `qpdf.wasm`,
 * and `pdfium.wasm` engines together against Issue #20's acceptance criteria:
 * 1. Balanced reduces a photo-heavy fixture by at least 50%.
 * 2. A text-only PDF never gets bigger.
 * 3. Target-size mode either meets the target or explains why it cannot.
 * 4. Transparency (PNG logos) still renders correctly after compression.
 */
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import { loadNodeQpdf } from "@/lib/qpdf/test-utils/node-qpdf";
import { asImagesPdfiumApi } from "@/tools/pdf-to-images/worker/load-pdfium";
import { DEFAULT_COMPRESS_OPTIONS } from "../core/options";
import { PdfCompressModule } from "./compress-pdf-module";
import { CompressSession } from "./compress-session";
import { PdfiumImageExtractor } from "./pdfium-image-extractor";
import { QpdfLosslessOptimizer } from "./qpdf-optimizer";

let session: CompressSession;

const readFixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url)),
  );

beforeAll(async () => {
  const wasmBytes = readFileSync(
    new URL("../../../../crates/pdf-compress/dist/pdf_compress.wasm", import.meta.url),
  );
  const [compressModule, qpdfRunner, pdfiumModule] = await Promise.all([
    PdfCompressModule.load("pdf-compress.wasm", async () =>
      wasmBytes.buffer.slice(
        wasmBytes.byteOffset,
        wasmBytes.byteOffset + wasmBytes.byteLength,
      ),
    ),
    loadNodeQpdf(),
    loadNodePdfiumModule(),
  ]);

  const qpdfOptimizer = new QpdfLosslessOptimizer(qpdfRunner);
  const imageExtractor = new PdfiumImageExtractor(asImagesPdfiumApi(pdfiumModule));
  session = new CompressSession(compressModule, qpdfOptimizer, imageExtractor);
}, 60_000);

describe("CompressSession (real WASM integration)", () => {
  it("reduces a photo-heavy PDF by at least 50% in Balanced mode", async () => {
    // Generate a deterministic textured high-res PNG (stored as Flate in pdf-lib)
    const width = 480;
    const height = 480;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        raw[i] = (x * 5 + y * 3) % 256;
        raw[i + 1] = (x * 7 + y * 11) % 256;
        raw[i + 2] = (x * 13 + y * 2) % 256;
        raw[i + 3] = 255;
      }
    }
    const png = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();

    const doc = await PDFDocument.create();
    const embedded = await doc.embedPng(png);
    doc.addPage([200, 200]).drawImage(embedded, {
      x: 0,
      y: 0,
      width: 144, // 2 inches -> 240 DPI downsampled to 150 DPI + JPEG encoded
      height: 144,
    });
    const input = await doc.save();

    const out = await session.compress(input, DEFAULT_COMPRESS_OPTIONS);
    expect(out.kind).toBe("compressed");
    if (out.kind === "compressed") {
      expect(out.compressedBytes).toBeLessThan(out.originalBytes * 0.5);
    }
  });

  it("never makes a text-only PDF bigger", async () => {
    const plain = readFixture("plain.pdf");
    const out = await session.compress(plain, {
      ...DEFAULT_COMPRESS_OPTIONS,
      preset: "lossless",
    });
    expect(out.kind).toBe("compressed");
    if (out.kind === "compressed") {
      expect(out.compressedBytes).toBeLessThanOrEqual(plain.length);
    }
  });

  it("target-size mode explains clearly when target cannot be reached safely", async () => {
    // Build a >75 KB text/vector PDF with 0 images (high-entropy lines so Flate stays >60 KB)
    const doc = await PDFDocument.create();
    const pages = 18;
    for (let p = 0; p < pages; p++) {
      const page = doc.addPage([600, 800]);
      for (let line = 0; line < 45; line++) {
        // Pseudo-random ASCII text so zlib cannot compress below 0.05 MB (~52 KB)
        let text = `P${p}L${line}: `;
        let state = (p * 131 + line * 977 + 17) >>> 0;
        for (let k = 0; k < 120; k++) {
          state = (state * 1664525 + 1013904223) >>> 0;
          text += String.fromCharCode(65 + (state % 26));
        }
        page.drawText(text, { x: 20, y: 770 - line * 16, size: 8 });
      }
    }
    const textHeavy = await doc.save();
    expect(textHeavy.length).toBeGreaterThan(60_000);

    const out = await session.compress(textHeavy, {
      ...DEFAULT_COMPRESS_OPTIONS,
      preset: "target-size",
      targetSizeMb: 0.05,
    });
    expect(out.kind).toBe("compressed");
    if (out.kind === "compressed") {
      expect(out.targetEvaluation?.targetMet).toBe(false);
      expect(out.targetEvaluation?.explanation).toMatch(/mostly text/i);
    }
  });

  it("preserves transparency on PNG logos after compression", async () => {
    const { ImagesSession } = await import(
      "@/tools/pdf-to-images/engine/images-session"
    );
    const { encodePng } = await import("@/lib/png/png-encoder");
    const { deflateZlib } = await import("@/lib/png/deflate");
    const pdfiumApi = asImagesPdfiumApi(await loadNodePdfiumModule());
    const extractor = new PdfiumImageExtractor(pdfiumApi);

    const out = await session.compress(
      readFixture("images-chromium.pdf"),
      DEFAULT_COMPRESS_OPTIONS,
    );
    expect(out.kind).toBe("compressed");
    if (out.kind === "compressed") {
      // 1. Verify the embedded transparent PNG still extracts with exact 128 alpha on right half
      const imgSession = new ImagesSession(pdfiumApi, {
        png: (img) => encodePng(img, deflateZlib),
        jpeg: async (img, q) =>
          new Uint8Array(
            await sharp(Buffer.from(img.pixels), {
              raw: { width: img.width, height: img.height, channels: 4 },
            })
              .jpeg({ quality: Math.round(q * 100) })
              .toBuffer(),
          ),
      });
      imgSession.open(out.pdf, "");
      const entries = await imgSession.extractImages(0, []);
      imgSession.close();

      const pngEntry = entries.find(
        (e) => e.kind === "image" && e.mimeType === "image/png",
      );
      expect(pngEntry).toBeDefined();
      if (pngEntry && pngEntry.kind === "image") {
        const decoded = await sharp(pngEntry.bytes)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(decoded.info.width).toBe(24);
        expect(decoded.info.height).toBe(16);
        // Left half opaque red, right half semi-transparent blue (alpha === 128)
        expect(decoded.data[3]).toBe(255);
        expect(decoded.data[12 * 4 + 3]).toBe(128);
      }

      // 2. Verify rendered page comparison remains faithful
      const preview = extractor.renderPreviewPair(
        readFixture("images-chromium.pdf"),
        out.pdf,
        0,
        400,
      );
      expect(preview.originalPixels.length).toBe(preview.compressedPixels.length);
      let maxDiff = 0;
      for (let i = 0; i < preview.originalPixels.length; i++) {
        const diff = Math.abs(
          preview.originalPixels[i] - preview.compressedPixels[i],
        );
        if (diff > maxDiff) maxDiff = diff;
      }
      expect(maxDiff).toBeLessThan(80);
    }
  });
});
