/**
 * The slice of the PDFium WebAssembly module (`@embedpdf/pdfium`) that the
 * editor uses.
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

/** Emscripten runtime helpers for moving data in and out of WASM memory. */
export interface PdfiumRuntime {
  /**
   * A byte view of the whole WebAssembly memory. Emscripten replaces this
   * view when the memory grows, so it must be read again after any call that
   * may allocate; never keep a reference to it.
   */
  readonly HEAPU8: Uint8Array;
  wasmExports: {
    malloc(size: number): number;
    free(ptr: number): void;
  };
  stringToUTF16(text: string, outPtr: number, maxBytesToWrite: number): void;
  /** Read a zero-terminated UTF-16LE string. */
  UTF16ToString(ptr: number): string;
  /** Read a zero-terminated UTF-8 string. */
  UTF8ToString(ptr: number): string;
  setValue(ptr: number, value: number, type: string): void;
  /** Returns a bigint only for 64-bit integer types ("i64"). */
  getValue(ptr: number, type: string): number | bigint;
}

/** The PDFium functions the editor calls (signatures from PDFium's C API). */
export interface PdfiumApi {
  pdfium: PdfiumRuntime;

  FPDF_GetLastError(): number;
  FPDF_LoadMemDocument(dataPtr: number, size: number, password: string): number;
  /** A new, empty, unencrypted document (the page organizer's output). */
  FPDF_CreateNewDocument(): number;
  FPDF_CloseDocument(doc: number): void;
  /**
   * Copy pages of `srcDoc` into `destDoc`, inserted together at `index`.
   * Objects the pages share are copied once per call.
   */
  FPDF_ImportPagesByIndex(
    destDoc: number,
    srcDoc: number,
    indicesPtr: number,
    length: number,
    index: number,
  ): boolean;
  /**
   * Insert an empty page of `width` x `height` points at `index`. Returns
   * the loaded page, which the caller must close.
   */
  FPDFPage_New(
    doc: number,
    index: number,
    width: number,
    height: number,
  ): number;
  FPDF_GetPageCount(doc: number): number;
  FPDF_LoadPage(doc: number, index: number): number;
  FPDF_ClosePage(page: number): void;
  FPDF_GetPageBoundingBox(page: number, rectPtr: number): boolean;
  FPDF_MovePages(
    doc: number,
    indicesPtr: number,
    count: number,
    destIndex: number,
  ): boolean;
  FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number,
  ): void;

  FPDFPage_GetRotation(page: number): number;
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

  FPDFBitmap_Create(width: number, height: number, alpha: number): number;
  FPDFBitmap_FillRect(
    bitmap: number,
    left: number,
    top: number,
    width: number,
    height: number,
    color: number,
  ): boolean;
  FPDFBitmap_GetBuffer(bitmap: number): number;
  FPDFBitmap_GetStride(bitmap: number): number;
  FPDFBitmap_Destroy(bitmap: number): void;

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

  PDFiumExt_OpenFileWriter(): number;
  PDFiumExt_SaveAsCopy(doc: number, writer: number): number;
  PDFiumExt_GetFileWriterSize(writer: number): number;
  PDFiumExt_GetFileWriterData(
    writer: number,
    dataPtr: number,
    size: number,
  ): number;
  PDFiumExt_CloseFileWriter(writer: number): void;
}

/** `FPDF_GetLastError` codes (fpdfview.h). */
export const FPDF_ERR = {
  SUCCESS: 0,
  UNKNOWN: 1,
  FILE: 2,
  FORMAT: 3,
  PASSWORD: 4,
  SECURITY: 5,
  PAGE: 6,
} as const;

/** Render annotations (form fields, stamps, comments) as readers do. */
const FPDF_ANNOT = 0x01;
/** Write pixels as R, G, B, A instead of PDFium's native B, G, R, A. */
const FPDF_REVERSE_BYTE_ORDER = 0x10;
/** Flags for page rendering: RGBA output, ready for canvas `ImageData`. */
export const RENDER_FLAGS = FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER;

/** `FPDFPath_SetDrawMode` fill modes. */
export const FILL_MODE = { NONE: 0, ALTERNATE: 1, WINDING: 2 } as const;
/** `FPDFPageObj_SetLineCap` / `SetLineJoin` value for rounded ends and corners. */
export const ROUND = 1;

/** `FPDFPageObj_GetType` value of a text object. */
export const PAGE_OBJECT_TEXT = 1;
