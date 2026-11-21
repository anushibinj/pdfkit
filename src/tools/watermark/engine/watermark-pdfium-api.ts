import type { PdfiumCoreApi } from "@/lib/pdfium/core-api";

/**
 * The PDFium functions the watermark tool calls: the shared core (open,
 * create, render, save) plus drawing text and pictures, turning a page into
 * a reusable form XObject and reading a page's TrimBox.
 *
 * `worker/load-engines.ts` checks at compile time that the real module
 * (`@embedpdf/pdfium`) satisfies this interface. Signatures follow PDFium's
 * C API; handles and pointers are numbers, 0 means "failed".
 */
export interface WatermarkPdfiumApi extends PdfiumCoreApi {
  /** Writes the page's in-memory objects into its content stream. */
  FPDFPage_GenerateContent(page: number): boolean;
  FPDFPage_InsertObject(page: number, object: number): void;
  /** False when the page has no /TrimBox of its own (it is not inherited). */
  FPDFPage_GetTrimBox(
    page: number,
    leftPtr: number,
    bottomPtr: number,
    rightPtr: number,
    topPtr: number,
  ): boolean;

  FPDFPageObj_NewTextObj(doc: number, font: string, fontSize: number): number;
  FPDFText_SetText(textObject: number, utf16Ptr: number): boolean;
  FPDFPageObj_NewImageObj(doc: number): number;
  EPDFImageObj_SetPng(
    page: number,
    count: number,
    image: number,
    dataPtr: number,
    size: number,
  ): boolean;
  EPDFImageObj_SetJpeg(
    page: number,
    count: number,
    image: number,
    dataPtr: number,
    size: number,
  ): boolean;
  /**
   * The decoded image's size. The EPDFImageObj_Set* loaders return true
   * even for a damaged file; the size is then 0 x 0 (checked against the
   * real build), which is how a broken picture is detected.
   */
  FPDFImageObj_GetImagePixelSize(
    image: number,
    widthPtr: number,
    heightPtr: number,
  ): boolean;
  /** An alpha below 255 makes PDFium write an ExtGState with /ca. */
  FPDFPageObj_SetFillColor(
    object: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): boolean;
  FPDFPageObj_GetBounds(
    object: number,
    leftPtr: number,
    bottomPtr: number,
    rightPtr: number,
    topPtr: number,
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
  /** Adds a marked-content tag (e.g. "Artifact") around the object. */
  FPDFPageObj_AddMark(object: number, name: string): number;
  FPDFPageObj_Destroy(object: number): void;

  /** Copies page `srcIndex` of `srcDoc` into `destDoc` as a form XObject. */
  FPDF_NewXObjectFromPage(
    destDoc: number,
    srcDoc: number,
    srcIndex: number,
  ): number;
  /** A new page object that draws the XObject (every copy shares it). */
  FPDF_NewFormObjectFromXObject(xobject: number): number;
  FPDF_CloseXObject(xobject: number): void;
}
