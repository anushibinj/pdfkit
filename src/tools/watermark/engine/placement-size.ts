import { viewSize, type PageBox, type Size } from "@/lib/pdfium/page-box";
import type { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { WatermarkPdfiumApi } from "./watermark-pdfium-api";

/** The PDFium function for reading a TrimBox. */
type TrimBoxApi = Pick<WatermarkPdfiumApi, "FPDFPage_GetTrimBox">;

/**
 * Read a page's own /TrimBox.
 *
 * @param api PDFium.
 * @param heap Memory helper.
 * @param page A loaded page.
 * @returns The box, or `null` when the page has none (or a degenerate one).
 */
export function readTrimBox(
  api: TrimBoxApi,
  heap: WasmHeap,
  page: number,
): PageBox | null {
  return heap.using(heap.alloc(16), (ptr) => {
    if (!api.FPDFPage_GetTrimBox(page, ptr, ptr + 4, ptr + 8, ptr + 12))
      return null;
    const [left, bottom, right, top] = heap.readFloats(ptr, 4);
    return right > left && top > bottom ? { left, bottom, right, top } : null;
  });
}

/**
 * The size a stamp page must have to land exactly on a PDF page, as the
 * page is displayed.
 *
 * qpdf places an overlay page centred in the destination page's TrimBox,
 * falling back to its CropBox, then its MediaBox, and turns it so it is
 * upright as the page is displayed (it inverts the page's /Rotate); it only
 * scales the stamp down if it does not fit. So the stamp page gets:
 * - the TrimBox when the page has one (TrimBox is never inherited, so
 *   PDFium reading only the page's own entry matches qpdf);
 * - otherwise PDFium's page bounding box: the CropBox clipped to the
 *   MediaBox, with inheritance from parent page nodes resolved (PDFium's
 *   direct CropBox/MediaBox getters do not resolve inheritance, so they
 *   are not used). For a CropBox inside the MediaBox, as in practically
 *   every file, this is exactly qpdf's box;
 * - width and height swapped when the page is turned by 90 or 270 degrees.
 *
 * Known limit: pages with a /UserUnit other than 1 (very large formats)
 * would get a smaller watermark, because qpdf scales by 1/UserUnit and
 * PDFium cannot read UserUnit.
 *
 * @param doc The open PDF.
 * @param api PDFium.
 * @param heap Memory helper.
 * @param index 0-based page index.
 * @returns The displayed size in points.
 */
export function readPlacementSize(
  doc: PdfiumDocument,
  api: TrimBoxApi,
  heap: WasmHeap,
  index: number,
): Size {
  const info = doc.pageInfo(index);
  const trim = doc.withPage(index, (page) => readTrimBox(api, heap, page));
  return viewSize(trim ?? info.box, info.rotation);
}
