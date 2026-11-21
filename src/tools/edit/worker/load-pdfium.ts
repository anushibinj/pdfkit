import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { ModuleImporter } from "@/lib/module-importer";
import { loadPdfiumModule } from "@/lib/pdfium/load-pdfium";
import type { PdfiumApi } from "../engine/pdfium-api";

/**
 * Narrow the full PDFium module to the editor's interface.
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

/**
 * Load and initialise PDFium from our own origin (see `loadPdfiumModule`)
 * and narrow it to the editor's interface.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param importer Performs the dynamic import (injected for tests).
 * @returns The ready-to-use API.
 */
export async function loadPdfium(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<PdfiumApi> {
  return asPdfiumApi(await loadPdfiumModule(wasmDir, importer));
}
