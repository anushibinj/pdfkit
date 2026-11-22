import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { PdfiumApi } from "../engine/pdfium-api";

/**
 * Narrow the full PDFium module to the editor's interface (pass it to the
 * shared `loadPdfium`).
 *
 * This is an identity function at runtime. Its value is at compile time:
 * if the library's real signatures ever stop matching `PdfiumApi` (after an
 * upgrade, say), TypeScript fails here instead of the editor failing in a
 * user's browser.
 *
 * @param pdfium The initialised module.
 * @returns The same module, typed as {@link PdfiumApi}.
 */
export function asPdfiumApi(pdfium: WrappedPdfiumModule): PdfiumApi {
  return pdfium;
}
