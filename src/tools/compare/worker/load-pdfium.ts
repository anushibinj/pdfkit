/**
 * Loads and narrows the shared same-origin PDFium WASM module for the Compare
 * PDFs worker.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { ModuleImporter } from "@/lib/module-importer";
import { loadPdfiumModule } from "@/lib/pdfium/load-pdfium";
import type { ComparePdfiumApi } from "../engine/pdfium-api";

/**
 * Narrow the full `@embedpdf/pdfium` module to {@link ComparePdfiumApi}.
 *
 * @param pdfium Initialised PDFium WASM module.
 * @returns The same module narrowed to {@link ComparePdfiumApi}.
 */
export function asComparePdfiumApi(
  pdfium: WrappedPdfiumModule,
): ComparePdfiumApi {
  return pdfium;
}

/**
 * Load and initialise the shared same-origin PDFium WASM binary from `/wasm/`.
 *
 * @param wasmDir Absolute URL ending in `"/"` pointing at `/wasm/`.
 * @param importer Dynamic module importer (injected for unit tests).
 * @returns Narrowed {@link ComparePdfiumApi} instance.
 */
export async function loadComparePdfium(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<ComparePdfiumApi> {
  return asComparePdfiumApi(await loadPdfiumModule(wasmDir, importer));
}
