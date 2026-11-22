/**
 * Test-only helpers that run the real PDFium WebAssembly build in Node, typed
 * for the editor. Node only.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node";
import type { PdfiumApi } from "../engine/pdfium-api";

// Shared with the other PDFium tools' integration tests.
export { pixelAt, toArrayBuffer } from "@/lib/pdfium/test-utils/node";

/** The full PDFium module (for inspection helpers the editor never needs). */
export type FullPdfium = WrappedPdfiumModule;

/**
 * Instantiate PDFium from the npm package's binary.
 *
 * @returns The module, usable both as the editor's narrow API and in full.
 */
export async function loadNodePdfium(): Promise<{
  api: PdfiumApi;
  full: FullPdfium;
}> {
  const full = await loadNodePdfiumModule();
  return { api: full as unknown as PdfiumApi, full };
}

/**
 * Extract every page's text from a PDF with PDFium.
 *
 * @param full The PDFium module.
 * @param bytes The PDF file.
 * @param password Its password, if any.
 * @returns One string per page.
 */
export function extractText(
  full: FullPdfium,
  bytes: Uint8Array,
  password = "",
): string[] {
  const { pdfium } = full;
  const ptr = pdfium.wasmExports.malloc(bytes.length);
  pdfium.HEAPU8.set(bytes, ptr);
  const doc = full.FPDF_LoadMemDocument(ptr, bytes.length, password);
  if (!doc) throw new Error(`load failed: ${full.FPDF_GetLastError()}`);
  const pages: string[] = [];
  for (let i = 0; i < full.FPDF_GetPageCount(doc); i++) {
    const page = full.FPDF_LoadPage(doc, i);
    const text = full.FPDFText_LoadPage(page);
    const n = full.FPDFText_CountChars(text);
    const buf = pdfium.wasmExports.malloc((n + 1) * 2);
    full.FPDFText_GetText(text, 0, n, buf);
    pages.push(pdfium.UTF16ToString(buf));
    pdfium.wasmExports.free(buf);
    full.FPDFText_ClosePage(text);
    full.FPDF_ClosePage(page);
  }
  full.FPDF_CloseDocument(doc);
  pdfium.wasmExports.free(ptr);
  return pages;
}
