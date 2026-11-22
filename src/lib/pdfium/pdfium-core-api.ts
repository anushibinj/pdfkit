/**
 * The core of the PDFium WebAssembly module (`@embedpdf/pdfium`) that every
 * tool needs: opening a document, reading page boxes, rendering pages and
 * saving. Tools extend it with the functions they need on top (the editor's
 * `PdfiumApi`, the cropper's `CropPdfiumApi`), so each depends on a small,
 * explicit surface (interface segregation) and tests can fake exactly that.
 *
 * All handles (documents, pages, bitmaps, writers) and pointers are plain
 * numbers: addresses inside the WebAssembly memory. 0 means "failed".
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

/** The PDFium functions `PdfiumDocument` uses (signatures from PDFium's C API). */
export interface PdfiumCoreApi {
  pdfium: PdfiumRuntime;

  FPDF_GetLastError(): number;
  FPDF_LoadMemDocument(dataPtr: number, size: number, password: string): number;
  FPDF_CloseDocument(doc: number): void;
  FPDF_GetPageCount(doc: number): number;
  FPDF_LoadPage(doc: number, index: number): number;
  FPDF_ClosePage(page: number): void;
  FPDF_GetPageBoundingBox(page: number, rectPtr: number): boolean;
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
