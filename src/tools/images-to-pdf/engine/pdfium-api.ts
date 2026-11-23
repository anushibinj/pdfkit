import type { PdfiumCoreApi } from "@/lib/pdfium/core-api";
import type { PageObjectApi } from "@/lib/pdfium/page-objects";

/**
 * Interface Segregation Principle (ISP): the exact minimal slice of PDFium
 * (`@embedpdf/pdfium`) needed by Images to PDF.
 *
 * Extending {@link PdfiumCoreApi} and {@link PageObjectApi} keeps this tool
 * decoupled from text editing, form XObjects, or rendering APIs it does not
 * call, and makes unit-test fakes tiny and explicit.
 *
 * `worker/load-pdfium.ts` verifies at compile time that the real
 * `WrappedPdfiumModule` satisfies this interface.
 */
export interface ImagesToPdfPdfiumApi extends PdfiumCoreApi, PageObjectApi {
  /** Serialise the page's in-memory objects into its PDF content stream. */
  FPDFPage_GenerateContent(page: number): boolean;
  /** Allocate a new, empty image page object belonging to `doc`. */
  FPDFPageObj_NewImageObj(doc: number): number;
  /** Decode PNG bytes into `image`, preserving alpha as a soft mask. */
  EPDFImageObj_SetPng(
    page: number,
    count: number,
    image: number,
    dataPtr: number,
    size: number,
  ): boolean;
  /** Embed JPEG bytes directly into `image` as `/DCTDecode` (no re-encoding). */
  EPDFImageObj_SetJpeg(
    page: number,
    count: number,
    image: number,
    dataPtr: number,
    size: number,
  ): boolean;
  /**
   * Read the decoded pixel dimensions of an image object.
   *
   * `EPDFImageObj_SetPng` and `EPDFImageObj_SetJpeg` can return `true` even on
   * damaged/truncated files; PDFium then reports `0 x 0` here, allowing us to
   * reject broken images reliably before saving.
   */
  FPDFImageObj_GetImagePixelSize(
    image: number,
    widthPtr: number,
    heightPtr: number,
  ): boolean;
}
