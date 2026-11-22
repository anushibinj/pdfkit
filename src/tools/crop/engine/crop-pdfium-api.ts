import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { PdfiumCoreApi } from "@/lib/pdfium/pdfium-core-api";

/**
 * The PDFium functions the crop tool calls, on top of the core ones
 * (signatures from PDFium's C API). PDFium only shows pages and checks the
 * result here; the cropping itself is done by the pdf-crop module.
 */
export interface CropPdfiumApi extends PdfiumCoreApi {
  /** -1 for an unencrypted document, else the security handler revision. */
  FPDF_GetSecurityHandlerRevision(doc: number): number;
  /** Changes the loaded page's CropBox (in memory, for checking renders). */
  FPDFPage_SetCropBox(
    page: number,
    left: number,
    bottom: number,
    right: number,
    top: number,
  ): void;
  FPDFText_LoadPage(page: number): number;
  FPDFText_ClosePage(textPage: number): void;
  FPDFText_CountChars(textPage: number): number;
  FPDFText_GetUnicode(textPage: number, index: number): number;
  /** 1 for characters PDFium made up (spaces, line breaks), 0 for real ones. */
  FPDFText_IsGenerated(textPage: number, index: number): number;
  /** Writes four doubles: left, right, bottom, top. */
  FPDFText_GetCharBox(
    textPage: number,
    index: number,
    leftPtr: number,
    rightPtr: number,
    bottomPtr: number,
    topPtr: number,
  ): boolean;
  FPDFText_GetCharOrigin(
    textPage: number,
    index: number,
    xPtr: number,
    yPtr: number,
  ): boolean;
}

/**
 * Narrow the full PDFium module to the crop tool's interface (pass it to
 * `loadPdfium`).
 *
 * An identity function at runtime; at compile time TypeScript checks that
 * the library's real signatures still match {@link CropPdfiumApi}.
 *
 * @param pdfium The initialised module.
 * @returns The same module, typed as {@link CropPdfiumApi}.
 */
export function asCropPdfiumApi(pdfium: WrappedPdfiumModule): CropPdfiumApi {
  return pdfium;
}
