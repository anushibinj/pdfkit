/**
 * Test-only helpers that run the real PDFium WebAssembly build in Node,
 * typed for the editor. Node only (uses fs).
 */
import {
  loadNodePdfium as loadFullPdfium,
  type FullPdfium,
} from "@/lib/pdfium/test-utils/pdfium-node";
import type { PdfiumApi } from "../engine/pdfium-api";

export {
  extractText,
  pixelAt,
  toArrayBuffer,
  type FullPdfium,
} from "@/lib/pdfium/test-utils/pdfium-node";

/**
 * Instantiate PDFium from the npm package's binary.
 *
 * @returns The module, as the editor's narrow API and in full.
 */
export async function loadNodePdfium(): Promise<{
  api: PdfiumApi;
  full: FullPdfium;
}> {
  const full = await loadFullPdfium();
  return { api: full as unknown as PdfiumApi, full };
}
