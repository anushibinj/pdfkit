// @vitest-environment node
import { describe, expect, it } from "vitest";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import { readPageCharsWithBoxes } from "./page-text-extractor";
import type { RedactPdfiumApi } from "./redact-pdfium-api";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { buildSearchablePageText } from "../core/text-search";
import fs from "node:fs";
import path from "node:path";

describe("readPageCharsWithBoxes", () => {
  it("extracts character boxes, origins, and textObjectIndex from a real PDF", async () => {
    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const heap = new WasmHeap(api.pdfium);
    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve("fixtures/text-chromium.pdf")),
    );
    const doc = PdfiumDocument.open(api, heap, bytes, "");
    try {
      const chars = doc.withPage(0, (page) =>
        readPageCharsWithBoxes(api, heap, page),
      );
      expect(chars.length).toBeGreaterThan(20);
      expect(chars.some((c) => c.textObjectIndex >= 0)).toBe(true);
      const { text } = buildSearchablePageText(chars);
      expect(text).toContain("Total amount due");
    } finally {
      doc.close();
    }
  });
});
