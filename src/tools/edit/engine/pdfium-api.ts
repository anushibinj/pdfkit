import type { PdfiumCoreApi } from "@/lib/pdfium/core-api";

/**
 * The slice of the PDFium WebAssembly module (`@embedpdf/pdfium`) that the
 * editor uses: the shared core (opening, rendering, saving; see
 * `@/lib/pdfium/core-api`) plus the editing functions below.
 *
 * Declared here instead of importing the library's full type so that:
 * - the engine depends on a small, explicit surface (about 70 of the ~500
 *   exported functions), and tests can fake exactly that surface;
 * - this module never pulls in the 4.6 MB WebAssembly binary.
 * `load-pdfium.ts` checks at compile time that the real module satisfies
 * this interface.
 *
 * All handles (documents, pages, objects, bitmaps, writers) and pointers are
 * plain numbers: addresses inside the WebAssembly memory. 0 means "failed".
 */

/** The PDFium functions the editor calls (signatures from PDFium's C API). */
export interface PdfiumApi extends PdfiumCoreApi {
  FPDF_MovePages(
    doc: number,
    indicesPtr: number,
    count: number,
    destIndex: number,
  ): boolean;

  FPDFPage_SetRotation(page: number, rotation: number): void;
  FPDFPage_GenerateContent(page: number): boolean;
  FPDFPage_InsertObject(page: number, object: number): void;
  FPDFPage_InsertObjectAtIndex(
    page: number,
    object: number,
    index: number,
  ): boolean;
  FPDFPage_RemoveObject(page: number, object: number): boolean;
  FPDFPage_CountObjects(page: number): number;
  FPDFPage_GetObject(page: number, index: number): number;
  FPDFPage_Delete(doc: number, index: number): void;

  FPDFPageObj_NewTextObj(doc: number, font: string, fontSize: number): number;
  FPDFPageObj_CreateTextObj(
    doc: number,
    font: number,
    fontSize: number,
  ): number;
  FPDFText_SetText(textObject: number, utf16Ptr: number): boolean;
  FPDFPageObj_CreateNewPath(x: number, y: number): number;
  FPDFPageObj_CreateNewRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): number;
  FPDFPath_LineTo(path: number, x: number, y: number): boolean;
  FPDFPath_SetDrawMode(
    path: number,
    fillMode: number,
    stroke: boolean,
  ): boolean;
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
  FPDFPageObj_SetFillColor(
    object: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): boolean;
  FPDFPageObj_SetStrokeColor(
    object: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): boolean;
  FPDFPageObj_SetStrokeWidth(object: number, width: number): boolean;
  FPDFPageObj_SetLineCap(object: number, cap: number): boolean;
  FPDFPageObj_SetLineJoin(object: number, join: number): boolean;
  FPDFPageObj_SetBlendMode(object: number, mode: string): void;
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

  /** Reading existing objects (in-place text editing). */
  FPDFPageObj_GetType(object: number): number;
  FPDFPageObj_GetMatrix(object: number, matrixPtr: number): boolean;
  FPDFPageObj_SetMatrix(object: number, matrixPtr: number): boolean;
  FPDFPageObj_GetBounds(
    object: number,
    leftPtr: number,
    bottomPtr: number,
    rightPtr: number,
    topPtr: number,
  ): boolean;
  FPDFPageObj_GetFillColor(
    object: number,
    rPtr: number,
    gPtr: number,
    bPtr: number,
    aPtr: number,
  ): boolean;
  FPDFPageObj_GetStrokeColor(
    object: number,
    rPtr: number,
    gPtr: number,
    bPtr: number,
    aPtr: number,
  ): boolean;
  FPDFPageObj_GetStrokeWidth(object: number, widthPtr: number): boolean;
  FPDFTextObj_GetText(
    textObject: number,
    textPage: number,
    bufferPtr: number,
    byteLength: number,
  ): number;
  FPDFTextObj_GetFont(textObject: number): number;
  FPDFTextObj_GetFontSize(textObject: number, sizePtr: number): boolean;
  FPDFTextObj_GetTextRenderMode(textObject: number): number;
  FPDFTextObj_SetTextRenderMode(textObject: number, mode: number): boolean;
  FPDFFont_GetBaseFontName(
    font: number,
    bufferPtr: number,
    byteLength: number,
  ): number;
  FPDFFont_GetFamilyName(
    font: number,
    bufferPtr: number,
    byteLength: number,
  ): number;
  FPDFFont_GetFlags(font: number): number;
  FPDFFont_GetWeight(font: number): number;
  FPDFFont_GetItalicAngle(font: number, anglePtr: number): boolean;
  FPDFFont_GetIsEmbedded(font: number): number;

  /** The text page: PDFium's character-level view of a page's text. */
  FPDFText_LoadPage(page: number): number;
  FPDFText_ClosePage(textPage: number): void;
  FPDFText_CountChars(textPage: number): number;
  FPDFText_GetUnicode(textPage: number, index: number): number;
  FPDFText_IsGenerated(textPage: number, index: number): number;
  FPDFText_GetTextObject(textPage: number, index: number): number;
  FPDFText_GetCharOrigin(
    textPage: number,
    index: number,
    xPtr: number,
    yPtr: number,
  ): boolean;
}

/** `FPDFPath_SetDrawMode` fill modes. */
export const FILL_MODE = { NONE: 0, ALTERNATE: 1, WINDING: 2 } as const;
/** `FPDFPageObj_SetLineCap` / `SetLineJoin` value for rounded ends and corners. */
export const ROUND = 1;

/** `FPDFPageObj_GetType` value of a text object. */
export const PAGE_OBJECT_TEXT = 1;
