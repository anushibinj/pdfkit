import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { PageChar } from "../core/verify";
import type { CropPdfiumApi } from "./crop-pdfium-api";

/**
 * Read every real character of a loaded page: its code point, origin and
 * tight box, in user space.
 *
 * PDFium's text page (`FPDFText_LoadPage`) lists the characters it
 * extracted, including ones it made up between words and lines
 * ("generated"); those are skipped, since they are not in the file. A
 * character whose box or origin PDFium cannot give is skipped too. The
 * text page is always closed, and the scratch memory freed, even if
 * reading fails.
 *
 * @param api The PDFium module.
 * @param heap Memory helper for that module.
 * @param page A loaded `FPDF_PAGE`.
 * @returns The characters, in PDFium's order.
 * @throws When the text page cannot be built.
 */
export function readPageChars(
  api: CropPdfiumApi,
  heap: WasmHeap,
  page: number,
): PageChar[] {
  const textPage = api.FPDFText_LoadPage(page);
  if (!textPage) throw new Error("Could not read the text of this page");
  try {
    const count = api.FPDFText_CountChars(textPage);
    // Six doubles: left, right, bottom, top, then the origin's x and y.
    return heap.using(heap.alloc(48), (buffer) => {
      const chars: PageChar[] = [];
      for (let i = 0; i < count; i++) {
        if (api.FPDFText_IsGenerated(textPage, i) !== 0) continue;
        const boxed = api.FPDFText_GetCharBox(
          textPage,
          i,
          buffer,
          buffer + 8,
          buffer + 16,
          buffer + 24,
        );
        if (!boxed) continue;
        if (!api.FPDFText_GetCharOrigin(textPage, i, buffer + 32, buffer + 40))
          continue;
        const [left, right, bottom, top, x, y] = heap.readDoubles(buffer, 6);
        chars.push({
          unicode: api.FPDFText_GetUnicode(textPage, i),
          x,
          y,
          box: { left, bottom, right, top },
        });
      }
      return chars;
    });
  } finally {
    api.FPDFText_ClosePage(textPage);
  }
}
