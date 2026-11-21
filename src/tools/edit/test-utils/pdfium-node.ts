/**
 * Test-only helpers that run the real PDFium WebAssembly build in Node and
 * build small fixture files. Node only.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import type { PdfiumApi } from "../engine/pdfium-api";

export {
  extractText,
  pixelAt,
  toArrayBuffer,
} from "@/lib/pdfium/test-utils/node-pdfium";

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
