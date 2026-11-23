/**
 * Segregated slice of the PDFium WebAssembly module (`@embedpdf/pdfium`) used
 * by the OCR PDF tool (Interface Segregation Principle).
 */

import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { ModuleImporter } from "@/lib/module-importer";
import { loadPdfiumModule } from "@/lib/pdfium/load-pdfium";
import type { ImagesToPdfPdfiumApi } from "@/tools/images-to-pdf/engine/pdfium-api";

/**
 * Narrow PDFium C-API contract required by OCR PDF:
 * - Page rendering & geometry (`PdfiumCoreApi`)
 * - Text extraction for auto-skipping pages that already contain real text
 * - TrimBox inspection for `qpdf --overlay` alignment (`FPDFPage_GetTrimBox`)
 * - Image embedding for converting dropped PNG/JPEG scans into 1-page PDFs
 */
export interface OcrPdfiumApi extends ImagesToPdfPdfiumApi {
  FPDFText_LoadPage(page: number): number;
  FPDFText_ClosePage(textPage: number): void;
  FPDFText_CountChars(textPage: number): number;
  FPDFText_GetUnicode(textPage: number, index: number): number;
  FPDFPage_GetTrimBox(
    page: number,
    leftPtr: number,
    bottomPtr: number,
    rightPtr: number,
    topPtr: number,
  ): boolean;
}

/**
 * Compile-time narrowing check verifying `WrappedPdfiumModule` satisfies {@link OcrPdfiumApi}.
 *
 * @param pdfium Initialized PDFium module.
 * @returns Same module typed as {@link OcrPdfiumApi}.
 */
export function asOcrPdfiumApi(pdfium: WrappedPdfiumModule): OcrPdfiumApi {
  return pdfium;
}

/**
 * Loads the shared self-hosted PDFium module from `/wasm/`, narrowed to {@link OcrPdfiumApi}.
 *
 * @param wasmDir Absolute `/wasm/` URL ending with `"/"`.
 * @param importer Dynamic module importer.
 * @returns Ready {@link OcrPdfiumApi}.
 */
export async function loadOcrPdfium(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<OcrPdfiumApi> {
  return asOcrPdfiumApi(await loadPdfiumModule(wasmDir, importer));
}
