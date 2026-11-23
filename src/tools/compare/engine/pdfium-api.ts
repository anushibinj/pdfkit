/**
 * Segregated slice of the PDFium WebAssembly module (`@embedpdf/pdfium`) used
 * by the Compare PDFs engine (Interface Segregation Principle).
 */
import type { PdfiumCoreApi } from "@/lib/pdfium/core-api";

/** Narrow PDFium C-API surface for PDF text/visual comparison and report export. */
export interface ComparePdfiumApi extends PdfiumCoreApi {
  /** Text page inspection (reading characters and tight glyph boxes). */
  FPDFText_LoadPage(page: number): number;
  FPDFText_ClosePage(textPage: number): void;
  FPDFText_CountChars(textPage: number): number;
  FPDFText_GetUnicode(textPage: number, index: number): number;
  FPDFText_IsGenerated(textPage: number, index: number): number;
  FPDFText_GetCharBox(
    textPage: number,
    index: number,
    leftPtr: number,
    rightPtr: number,
    bottomPtr: number,
    topPtr: number,
  ): boolean;

  /** Importing pages from source documents into the comparison report PDF. */
  FPDF_ImportPagesByIndex(
    destDoc: number,
    srcDoc: number,
    pageIndicesPtr: number,
    length: number,
    index: number,
  ): boolean;

  /** Creating and styling annotations on report pages. */
  FPDFPage_CreateAnnot(page: number, subtype: number): number;
  FPDFPage_CloseAnnot(annot: number): void;
  FPDFAnnot_SetColor(
    annot: number,
    type: number,
    R: number,
    G: number,
    B: number,
    A: number,
  ): boolean;
  FPDFAnnot_SetRect(annot: number, rectPtr: number): boolean;
  FPDFAnnot_AppendAttachmentPoints(
    annot: number,
    quadPointsPtr: number,
  ): boolean;
  FPDFAnnot_SetStringValue(
    annot: number,
    key: string,
    valuePtr: number,
  ): boolean;
  FPDFAnnot_SetFlags(annot: number, flags: number): boolean;
  FPDFAnnot_SetBorder(
    annot: number,
    horizontalRadius: number,
    verticalRadius: number,
    borderWidth: number,
  ): boolean;
  EPDFAnnot_GenerateAppearance(annot: number): boolean;

  /** Drawing text lines on the summary cover page of the report PDF. */
  FPDFPageObj_NewTextObj(doc: number, font: string, fontSize: number): number;
  FPDFText_SetText(textObject: number, utf16Ptr: number): boolean;
  FPDFPageObj_SetFillColor(
    object: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): boolean;
  FPDFPageObj_Transform(
    object: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  FPDFPageObj_Destroy(object: number): void;
  FPDFPage_InsertObject(page: number, object: number): void;
  FPDFPage_GenerateContent(page: number): boolean;
}

/** PDFium annotation subtype for a Square border box (`FPDF_ANNOT_SQUARE`). */
export const FPDF_ANNOT_SQUARE = 5;

/** PDFium annotation subtype for a text Highlight (`FPDF_ANNOT_HIGHLIGHT`). */
export const FPDF_ANNOT_HIGHLIGHT = 9;

/** PDFium color type for main/interior annotation color (`FPDFANNOT_COLORTYPE_Color`). */
export const FPDF_ANNOT_COLOR_MAIN = 0;

/** PDFium annotation flag requiring the annotation to be printed (`FPDF_ANNOT_FLAG_PRINT`). */
export const FPDF_ANNOT_FLAG_PRINT = 4;
