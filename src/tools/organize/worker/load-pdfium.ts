import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { OrganizePdfiumApi } from "../engine/organize-pdfium-api";

/**
 * Narrow the full PDFium module to the organizer's interface.
 *
 * This is an identity function at runtime. Its value is at compile time:
 * if the library's real signatures ever stop matching `OrganizePdfiumApi`
 * (after an upgrade, say), TypeScript fails here instead of the organizer
 * failing in a user's browser.
 *
 * @param pdfium The initialised module (see `loadPdfiumModule`).
 * @returns The same module, typed as {@link OrganizePdfiumApi}.
 */
export function asOrganizeApi(pdfium: WrappedPdfiumModule): OrganizePdfiumApi {
  return pdfium;
}
