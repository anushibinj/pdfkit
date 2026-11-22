import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { loadPdfiumModule, type ModuleImporter } from "@/lib/pdfium/load";
import type { ImagesPdfiumApi } from "../engine/pdfium-api";

/**
 * Narrow the full PDFium module to this tool's interface.
 *
 * An identity function at runtime. At compile time it fails if the
 * library's real signatures stop matching `ImagesPdfiumApi` (after an
 * upgrade, say), instead of the tool failing in a user's browser.
 *
 * @param pdfium The initialised module.
 * @returns The same module, typed as {@link ImagesPdfiumApi}.
 */
export function asImagesPdfiumApi(
  pdfium: WrappedPdfiumModule,
): ImagesPdfiumApi {
  return pdfium;
}

/**
 * Load and initialise PDFium from our own origin (see `loadPdfiumModule`),
 * typed as this tool's slice of it.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param importer Performs the dynamic import (injected for tests).
 * @returns The ready-to-use API.
 */
export async function loadImagesPdfium(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<ImagesPdfiumApi> {
  return asImagesPdfiumApi(await loadPdfiumModule(wasmDir, importer));
}
