import type { PdfiumCoreApi } from "@/lib/pdfium/core-api";
import {
  PdfiumDocument,
  type RenderedPage,
} from "@/lib/pdfium/pdfium-document";
import { fitRenderSize } from "@/lib/pdfium/render-size";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { usablePageSize } from "../core/usable-page-size";
import type { PageSize } from "../messages";

/**
 * The PDFium functions the preview calls: the shared core functions, plus
 * reading a page's size without loading the page.
 */
export interface PreviewPdfiumApi extends PdfiumCoreApi {
  FPDF_GetPageSizeByIndexF(doc: number, index: number, sizePtr: number): boolean;
}

/**
 * The preview worker's state: one opened PDF, drawn as page thumbnails.
 *
 * Opening reads every page's size up front, so the UI can lay out the
 * whole grid (right shapes, no jumping) before any page is drawn. It uses
 * `FPDF_GetPageSizeByIndexF`, which reads the page dictionary only; loading
 * every page with `FPDF_LoadPage` would also parse every page's content,
 * which is slow for long files. The size it reports already has the page's
 * own /Rotate applied, which matches how `PdfiumDocument.render` draws it.
 */
export class PreviewSession {
  private readonly heap: WasmHeap;
  private doc: PdfiumDocument | null = null;
  private pages: PageSize[] = [];

  /** @param api The initialised PDFium module. */
  constructor(private readonly api: PreviewPdfiumApi) {
    this.heap = new WasmHeap(api.pdfium);
  }

  /**
   * Open a file, replacing any open one.
   *
   * @param bytes The PDF file.
   * @param password The user password, or "" for none.
   * @returns Every page's shown size.
   * @throws {PdfOpenError} When PDFium refuses the file.
   * @throws When it has no pages, or a size cannot be read.
   */
  open(bytes: Uint8Array, password: string): PageSize[] {
    this.close();
    const doc = PdfiumDocument.open(this.api, this.heap, bytes, password);
    try {
      const count = doc.pageCount();
      if (count < 1) throw new Error("This PDF has no pages.");
      this.pages = Array.from({ length: count }, (_, i) => this.readSize(doc, i));
    } catch (err) {
      doc.close();
      throw err;
    }
    this.doc = doc;
    return this.pages;
  }

  /**
   * Draw one page as a thumbnail.
   *
   * @param pageIndex 0-based page index.
   * @param width Requested width in pixels (clamped, see `fitRenderSize`).
   * @returns RGBA pixels on white.
   * @throws When nothing is open or the page does not exist.
   */
  render(pageIndex: number, width: number): RenderedPage {
    if (!this.doc) throw new Error("No PDF is open.");
    // Checked as an integer: a message could carry "length" or 1.5, and
    // this.pages["length"] would be a number, not a page.
    const page = Number.isInteger(pageIndex) ? this.pages[pageIndex] : undefined;
    if (!page) throw new Error(`There is no page ${Number(pageIndex) + 1}.`);
    const size = fitRenderSize(page, width);
    return this.doc.render(pageIndex, size.width, size.height, 0);
  }

  /** Close the open file and free its memory. Safe to call when closed. */
  close(): void {
    this.doc?.close();
    this.doc = null;
    this.pages = [];
  }

  /**
   * Read a page's shown size. PDFium writes an `FS_SIZEF` (two floats:
   * width, height) into memory we provide.
   *
   * @param doc The document.
   * @param index 0-based page index.
   * @returns The size (Letter if the file's own size is unusable).
   * @throws When PDFium cannot read the page.
   */
  private readSize(doc: PdfiumDocument, index: number): PageSize {
    const [width, height] = this.heap.using(this.heap.alloc(8), (ptr) => {
      if (!this.api.FPDF_GetPageSizeByIndexF(doc.handle, index, ptr)) {
        throw new Error(`Could not read the size of page ${index + 1}.`);
      }
      return this.heap.readFloats(ptr, 2);
    });
    return usablePageSize(width, height);
  }
}
