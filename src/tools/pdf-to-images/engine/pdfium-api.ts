/**
 * The slice of the PDFium WebAssembly module (`@embedpdf/pdfium`) that the
 * PDF to Images tool uses: opening and rendering pages (from the shared
 * `PdfiumDocumentApi`), plus walking page objects and reading image
 * objects. `worker/load-pdfium.ts` checks at compile time that the real
 * module satisfies this interface.
 *
 * Signatures follow PDFium's C API (public/fpdf_edit.h, fpdfview.h). All
 * handles and pointers are plain numbers: addresses inside the WebAssembly
 * memory; 0 means "failed" or "none".
 */
import type { PdfiumDocumentApi } from "@/lib/pdfium/document";

export interface ImagesPdfiumApi extends PdfiumDocumentApi {
  /** Page objects, in content order. */
  FPDFPage_CountObjects(page: number): number;
  FPDFPage_GetObject(page: number, index: number): number;
  /** One of {@link PAGE_OBJECT}. */
  FPDFPageObj_GetType(object: number): number;

  /** Objects inside a form XObject, in content order. */
  FPDFFormObj_CountObjects(form: number): number;
  FPDFFormObj_GetObject(form: number, index: number): number;

  /** Size of the image in pixels (two unsigned ints). */
  FPDFImageObj_GetImagePixelSize(
    image: number,
    widthPtr: number,
    heightPtr: number,
  ): boolean;
  FPDFImageObj_GetImageFilterCount(image: number): number;
  /** Filter name as a zero-terminated UTF-8 string; returns its length. */
  FPDFImageObj_GetImageFilter(
    image: number,
    index: number,
    buffer: number,
    byteLength: number,
  ): number;
  /** Fills an `FPDF_IMAGEOBJ_METADATA` (see {@link METADATA}). */
  FPDFImageObj_GetImageMetadata(
    image: number,
    page: number,
    metadataPtr: number,
  ): boolean;
  /**
   * The decoded ICC profile of an ICCBased image. With no buffer it only
   * writes the size to `outLengthPtr` (a 32-bit `size_t`).
   */
  FPDFImageObj_GetIccProfileDataDecoded(
    image: number,
    page: number,
    buffer: number,
    byteLength: number,
    outLengthPtr: number,
  ): boolean;
  /** The image stream's bytes before any filter is applied. */
  FPDFImageObj_GetImageDataRaw(
    image: number,
    buffer: number,
    byteLength: number,
  ): number;
  /**
   * The decoded image at its own pixel size, ignoring its mask and its
   * matrix. The caller owns the returned bitmap.
   */
  FPDFImageObj_GetBitmap(image: number): number;
  /**
   * The image drawn as on the page (mask, matrix and clip applied), at the
   * size its matrix gives it. The caller owns the returned bitmap.
   */
  FPDFImageObj_GetRenderedBitmap(
    doc: number,
    page: number,
    image: number,
  ): number;

  FPDFBitmap_GetWidth(bitmap: number): number;
  FPDFBitmap_GetHeight(bitmap: number): number;
  FPDFBitmap_GetFormat(bitmap: number): number;

  /** Six floats a, b, c, d, e, f (an `FS_MATRIX`). */
  FPDFPageObj_GetMatrix(object: number, matrixPtr: number): boolean;
  FPDFPageObj_SetMatrix(object: number, matrixPtr: number): boolean;
  FPDFPageObj_GetClipPath(object: number): number;
  /** -1 when the object has no clip at all, else its number of paths. */
  FPDFClipPath_CountPaths(clipPath: number): number;
  /** Four unsigned ints. Fails for objects without a fill colour. */
  FPDFPageObj_GetFillColor(
    object: number,
    rPtr: number,
    gPtr: number,
    bPtr: number,
    aPtr: number,
  ): boolean;
  /** Also sets the fill alpha (the graphics state's `ca`) to `a / 255`. */
  FPDFPageObj_SetFillColor(
    object: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): boolean;
}

/** `FPDFPageObj_GetType` values (fpdf_edit.h, `FPDF_PAGEOBJ_*`). */
export const PAGE_OBJECT = { IMAGE: 3, FORM: 5 } as const;

/**
 * Layout of `FPDF_IMAGEOBJ_METADATA` (fpdf_edit.h): unsigned width, unsigned
 * height, float horizontal_dpi, float vertical_dpi, unsigned bits_per_pixel,
 * int colorspace, int marked_content_id; seven 4-byte fields.
 */
export const METADATA = { SIZE: 28, COLORSPACE_OFFSET: 20 } as const;
