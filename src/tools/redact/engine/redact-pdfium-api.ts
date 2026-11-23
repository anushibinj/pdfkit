import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { PdfiumApi } from "@/tools/edit/engine/pdfium-api";

/**
 * Narrow PDFium WebAssembly interface required by the Redact PDF engine.
 *
 * Extends the editor's {@link PdfiumApi} with character bounding-box reads,
 * image bitmap read/write, path segment inspection, annotation removal, and
 * security handler removal (Interface Segregation Principle).
 */
export interface RedactPdfiumApi extends PdfiumApi {
  FPDF_GetSecurityHandlerRevision(doc: number): number;
  EPDF_RemoveEncryption(doc: number): boolean;

  FPDFText_GetCharBox(
    textPage: number,
    index: number,
    leftPtr: number,
    rightPtr: number,
    bottomPtr: number,
    topPtr: number,
  ): boolean;

  FPDFImageObj_GetBitmap(imageObject: number): number;
  FPDFImageObj_SetBitmap(
    pagesPtr: number,
    count: number,
    imageObject: number,
    bitmap: number,
  ): boolean;

  FPDFBitmap_GetWidth(bitmap: number): number;
  FPDFBitmap_GetHeight(bitmap: number): number;
  FPDFBitmap_GetFormat(bitmap: number): number;

  FPDFPath_CountSegments(path: number): number;
  FPDFPath_GetPathSegment(path: number, index: number): number;
  FPDFPathSegment_GetPoint(
    segment: number,
    xPtr: number,
    yPtr: number,
  ): boolean;

  FPDFPage_GetAnnotCount(page: number): number;
  FPDFPage_GetAnnot(page: number, index: number): number;
  FPDFPage_CloseAnnot(annot: number): void;
  FPDFPage_RemoveAnnot(page: number, index: number): boolean;
  FPDFAnnot_GetRect(annot: number, rectPtr: number): boolean;
  FPDFAnnot_GetSubtype(annot: number): number;
  FPDFAnnot_SetStringValue(
    annot: number,
    key: string,
    utf16Ptr: number,
  ): boolean;
}

/** `FPDFPageObj_GetType` constant for path objects. */
export const PAGE_OBJECT_PATH = 2;
/** `FPDFPageObj_GetType` constant for image objects. */
export const PAGE_OBJECT_IMAGE = 3;
/** `FPDFPageObj_GetType` constant for form XObject containers. */
export const PAGE_OBJECT_FORM = 5;
/** `FPDF_ANNOT_WIDGET` subtype constant in PDFium (`fpdf_annot.h`). */
export const ANNOT_SUBTYPE_WIDGET = 20;

/**
 * Compile-time narrowing of the full `@embedpdf/pdfium` module to
 * {@link RedactPdfiumApi}. Fails TypeScript compilation immediately if a PDFium
 * upgrade alters any required signature.
 *
 * @param pdfium Initialised PDFium WASM module.
 * @returns The same module typed as {@link RedactPdfiumApi}.
 */
export function asRedactPdfiumApi(pdfium: WrappedPdfiumModule): RedactPdfiumApi {
  return pdfium as unknown as RedactPdfiumApi;
}
