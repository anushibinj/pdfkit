import type { PdfiumCoreApi } from "@/lib/pdfium/core-api";

/**
 * The slice of the PDFium WebAssembly module the page organizer uses: the
 * shared core (opening, creating, rendering, saving, blank pages; see
 * `@/lib/pdfium/core-api`) plus the three page-tree functions below.
 *
 * Declared per tool (interface segregation) so the engine depends on, and
 * tests fake, exactly what it calls. `worker/load-pdfium.ts` checks at
 * compile time that the real module satisfies it.
 */
export interface OrganizePdfiumApi extends PdfiumCoreApi {
  /**
   * Copy pages of `srcDoc` into `destDoc`, inserted together at `index`.
   * Objects the pages share are copied once per call (see `planImports`).
   */
  FPDF_ImportPagesByIndex(
    destDoc: number,
    srcDoc: number,
    indicesPtr: number,
    length: number,
    index: number,
  ): boolean;
  /** Move the listed pages, in that order, to `destIndex`. */
  FPDF_MovePages(
    doc: number,
    indicesPtr: number,
    count: number,
    destIndex: number,
  ): boolean;
  /** Set a loaded page's /Rotate (clockwise quarter turns). */
  FPDFPage_SetRotation(page: number, rotation: number): void;
}
