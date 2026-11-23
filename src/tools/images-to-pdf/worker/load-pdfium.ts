import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { ModuleImporter } from "@/lib/module-importer";
import { loadPdfiumModule } from "@/lib/pdfium/load-pdfium";
import type { ImagesToPdfPdfiumApi } from "../engine/pdfium-api";

/**
 * Narrow the full PDFium WASM module to this tool's segregated interface.
 *
 * Identity at runtime; compile-time guardrail ensuring `@embedpdf/pdfium`
 * still matches every function signature declared in {@link ImagesToPdfPdfiumApi}.
 *
 * @param pdfium The initialised PDFium module.
 * @returns The same module, typed as {@link ImagesToPdfPdfiumApi}.
 */
export function asImagesToPdfPdfiumApi(
  pdfium: WrappedPdfiumModule,
): ImagesToPdfPdfiumApi {
  return pdfium;
}

/**
 * Load and initialise the shared same-origin PDFium WASM module from `/wasm/`,
 * narrowed to {@link ImagesToPdfPdfiumApi}.
 *
 * @param wasmDir Absolute URL of the `/wasm/` directory, ending in `"/"`.
 * @param importer Dynamic importer function (injected for unit tests).
 * @returns The ready-to-use PDFium API.
 */
export async function loadImagesToPdfPdfium(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<ImagesToPdfPdfiumApi> {
  return asImagesToPdfPdfiumApi(await loadPdfiumModule(wasmDir, importer));
}
