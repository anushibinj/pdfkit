// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { StandardFontMetricsSource } from "@/tools/edit/core/standard-font-metrics";
import { buildSearchablePageText } from "../core/text-search";
import { PageRedactor } from "./page-redactor";
import { readPageCharsWithBoxes } from "./page-text-extractor";
import { PAGE_OBJECT_IMAGE, type RedactPdfiumApi } from "./redact-pdfium-api";
import fs from "node:fs";
import path from "node:path";

describe("PageRedactor (real PDFium WASM)", () => {
  it("splits straddling text objects, removes covered glyphs, and keeps remaining text intact", async () => {
    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const heap = new WasmHeap(api.pdfium);
    const metrics = new StandardFontMetricsSource();
    const redactor = new PageRedactor(api, heap, metrics);

    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve("fixtures/text-chromium.pdf")),
    );
    const doc = PdfiumDocument.open(api, heap, bytes, "");
    let saved: Uint8Array;
    try {
      const info = doc.pageInfo(0);
      const chars = doc.withPage(0, (page) =>
        readPageCharsWithBoxes(api, heap, page),
      );
      const { text, charRefs } = buildSearchablePageText(chars);
      const idx = text.indexOf("1250");
      expect(idx).toBeGreaterThan(-1);
      const targetChars = charRefs
        .slice(idx, idx + 4)
        .filter((c): c is NonNullable<typeof c> => c !== null);
      const targetBox = {
        left: Math.min(...targetChars.map((c) => c.box.left)) - 0.5,
        bottom: Math.min(...targetChars.map((c) => c.box.bottom)) - 0.5,
        right: Math.max(...targetChars.map((c) => c.box.right)) + 0.5,
        top: Math.max(...targetChars.map((c) => c.box.top)) + 0.5,
      };

      const stats = doc.withPage(0, (page) =>
        redactor.redactPage(doc.handle, page, info, [targetBox], {
          fill: "black",
          label: "REDACTED",
        }),
      );
      expect(stats.textObjectsRemoved + stats.textObjectsSplit).toBeGreaterThan(
        0,
      );
      saved = doc.save();
    } finally {
      doc.close();
    }

    // Reopen saved document and confirm "1250" is gone while "Total amount due" remains!
    const reopened = PdfiumDocument.open(api, heap, saved, "");
    try {
      const charsAfter = reopened.withPage(0, (page) =>
        readPageCharsWithBoxes(api, heap, page),
      );
      const textAfter = buildSearchablePageText(charsAfter).text;
      expect(textAfter).not.toContain("1250");
      expect(textAfter).toContain("Total amount due");
    } finally {
      reopened.close();
    }
  });

  it("blanks pixels inside an image bitmap without altering a second shared instance", async () => {
    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const heap = new WasmHeap(api.pdfium);
    const metrics = new StandardFontMetricsSource();
    const redactor = new PageRedactor(api, heap, metrics);

    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve("fixtures/images-chromium.pdf")),
    );
    const doc = PdfiumDocument.open(api, heap, bytes, "");
    let saved: Uint8Array;
    try {
      const info = doc.pageInfo(0);
      // Find the first green JPEG image object (index 2 in images-chromium.pdf) and redact only it.
      const firstImageBox = doc.withPage(0, (page) => {
        const count = api.FPDFPage_CountObjects(page);
        for (let i = 0; i < count; i++) {
          const obj = api.FPDFPage_GetObject(page, i);
          if (api.FPDFPageObj_GetType(obj) === PAGE_OBJECT_IMAGE && i > 0) {
            return heap.using(heap.alloc(16), (ptr) => {
              api.FPDFPageObj_GetBounds(obj, ptr, ptr + 4, ptr + 8, ptr + 12);
              const [l, b, r, t] = heap.readFloats(ptr, 4);
              return { left: l, bottom: b, right: r, top: t };
            });
          }
        }
        throw new Error("Expected image object");
      });

      const stats = doc.withPage(0, (page) =>
        redactor.redactPage(doc.handle, page, info, [firstImageBox], {
          fill: "black",
          label: "",
        }),
      );
      expect(stats.imagesModified).toBe(1);
      saved = doc.save();
    } finally {
      doc.close();
    }

    // Reopen and verify the redacted image's pixels are 0 (black) while the second copy still has colour!
    const reopened = PdfiumDocument.open(api, heap, saved, "");
    try {
      reopened.withPage(0, (page) => {
        const imageBuffers: Uint8Array[] = [];
        const count = api.FPDFPage_CountObjects(page);
        for (let i = 0; i < count; i++) {
          const obj = api.FPDFPage_GetObject(page, i);
          if (api.FPDFPageObj_GetType(obj) === PAGE_OBJECT_IMAGE) {
            const bm = api.FPDFImageObj_GetBitmap(obj);
            const buf = api.FPDFBitmap_GetBuffer(bm);
            imageBuffers.push(api.pdfium.HEAPU8.slice(buf, buf + 12));
            api.FPDFBitmap_Destroy(bm);
          }
        }
        // Index 1 is the first copy of the green JPEG (now blanked black), index 2 is the untouched copy!
        expect(Array.from(imageBuffers[1]).every((v) => v === 0)).toBe(true);
        expect(Array.from(imageBuffers[2]).some((v) => v > 0)).toBe(true);
      });
    } finally {
      reopened.close();
    }
  });
});
