import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { PageCharWithBox } from "../core/text-search";
import type { RedactPdfiumApi } from "./redact-pdfium-api";

/**
 * Extract every non-generated character from a loaded `FPDF_PAGE` along with
 * its baseline origin, tight user-space bounding box, and owning text object
 * index.
 *
 * Generated whitespace/line-break characters emitted by PDFium (`FPDFText_IsGenerated`)
 * are skipped because they do not correspond to real glyphs in the content
 * stream; `buildSearchablePageText` reconstructs word/line separators from the
 * real character boxes.
 *
 * @param api PDFium module interface.
 * @param heap WASM heap helper for `api`.
 * @param page Loaded `FPDF_PAGE` handle.
 * @returns Array of {@link PageCharWithBox} in PDFium text-page order.
 */
export function readPageCharsWithBoxes(
  api: RedactPdfiumApi,
  heap: WasmHeap,
  page: number,
): PageCharWithBox[] {
  const objectIndices = new Map<number, number>();
  const objCount = api.FPDFPage_CountObjects(page);
  for (let i = 0; i < objCount; i++) {
    const obj = api.FPDFPage_GetObject(page, i);
    if (obj) objectIndices.set(obj, i);
  }

  const textPage = api.FPDFText_LoadPage(page);
  if (!textPage) throw new Error("Could not read the text of this page.");

  try {
    const count = api.FPDFText_CountChars(textPage);
    // 48 bytes = 6 doubles: left, right, bottom, top, originX, originY.
    return heap.using(heap.alloc(48), (buf) => {
      const chars: PageCharWithBox[] = [];
      let pendingSpace = false;
      let pendingNewline = false;

      for (let i = 0; i < count; i++) {
        const code = api.FPDFText_GetUnicode(textPage, i);
        if (api.FPDFText_IsGenerated(textPage, i) !== 0) {
          if (code === 10 || code === 13) pendingNewline = true;
          else if (code === 32 || code === 9) pendingSpace = true;
          continue;
        }
        // Ignore invalid/surrogate code points so String.fromCodePoint never throws.
        if (code <= 0 || code > 0x10ffff) continue;
        if (code >= 0xd800 && code <= 0xdfff) continue;

        const hasBox = api.FPDFText_GetCharBox(
          textPage,
          i,
          buf,
          buf + 8,
          buf + 16,
          buf + 24,
        );
        if (!hasBox) continue;

        const hasOrigin = api.FPDFText_GetCharOrigin(
          textPage,
          i,
          buf + 32,
          buf + 40,
        );
        const [left, right, bottom, top, ox, oy] = heap.readDoubles(buf, 6);
        const x = hasOrigin ? ox : left;
        const y = hasOrigin ? oy : bottom;
        const textObj = api.FPDFText_GetTextObject(textPage, i);
        const textObjectIndex = textObj
          ? (objectIndices.get(textObj) ?? -1)
          : -1;

        const prev = chars[chars.length - 1];
        const baselineJumped =
          prev !== undefined &&
          Math.abs(prev.y - y) > Math.max(4, Math.abs(top - bottom)) * 0.45;
        const spaceFallback =
          !pendingSpace &&
          !pendingNewline &&
          !baselineJumped &&
          prev !== undefined &&
          Math.min(left, right) - prev.box.right >
            Math.max(4, Math.abs(top - bottom)) * 0.35;

        chars.push({
          char: String.fromCodePoint(code),
          x,
          y,
          box: {
            left: Math.min(left, right),
            bottom: Math.min(bottom, top),
            right: Math.max(left, right),
            top: Math.max(bottom, top),
          },
          textObjectIndex,
          spaceBefore: pendingSpace || spaceFallback,
          newlineBefore: pendingNewline || baselineJumped,
        });
        pendingSpace = false;
        pendingNewline = false;
      }
      return chars;
    });
  } finally {
    api.FPDFText_ClosePage(textPage);
  }
}
