import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { PreviewPdfiumApi } from "../engine/preview-session";

/**
 * Narrow the full PDFium module to the preview's interface.
 *
 * This is an identity function at runtime. Its value is at compile time:
 * if the library's real signatures ever stop matching `PreviewPdfiumApi`
 * (after an upgrade, say), TypeScript fails here instead of the preview
 * failing in a user's browser.
 *
 * @param pdfium The initialised module (see `loadPdfiumModule`).
 * @returns The same module, typed as {@link PreviewPdfiumApi}.
 */
export function asPreviewApi(pdfium: WrappedPdfiumModule): PreviewPdfiumApi {
  return pdfium;
}
