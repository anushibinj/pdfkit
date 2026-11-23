/**
 * Extracts reading-order word tokens and tight PDF user-space glyph boxes
 * from a loaded PDFium page.
 */
import type { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { CharWithBox, ExtractedPageText } from "../core/model";
import { tokenizePageChars } from "../core/text-tokens";
import type { ComparePdfiumApi } from "./pdfium-api";

/**
 * Abstraction for extracting word tokens and bounding boxes from a PDF page
 * (Dependency Inversion Principle).
 */
export interface PdfTextExtractor {
  /**
   * Extract all reading-order text and word boxes from `pageIndex`.
   *
   * @param doc Open PDFium document.
   * @param pageIndex Zero-based page index.
   * @returns Page text snapshot with word tokens and page geometry.
   */
  extractPage(doc: PdfiumDocument, pageIndex: number): ExtractedPageText;
}

/**
 * PDFium-backed implementation of {@link PdfTextExtractor}.
 */
export class PdfiumPageTextExtractor implements PdfTextExtractor {
  /**
   * @param api Segregated PDFium WASM API.
   * @param heap Memory helper bound to `api.pdfium`.
   */
  constructor(
    private readonly api: ComparePdfiumApi,
    private readonly heap: WasmHeap,
  ) {}

  /**
   * Extract reading-order text and word bounding boxes for one page.
   *
   * @param doc Open {@link PdfiumDocument}.
   * @param pageIndex Zero-based page index.
   * @returns Extracted text, word tokens, scanned flag, and page geometry.
   * @throws When PDFium cannot load the page or its text layer.
   */
  extractPage(doc: PdfiumDocument, pageIndex: number): ExtractedPageText {
    const info = doc.pageInfo(pageIndex);

    return doc.withPage(pageIndex, (page) => {
      const textPage = this.api.FPDFText_LoadPage(page);
      if (!textPage) {
        throw new Error(`Could not read text from page ${pageIndex + 1}.`);
      }

      try {
        const count = this.api.FPDFText_CountChars(textPage);
        const chars = this.heap.using(this.heap.alloc(32), (boxPtr) => {
          const result: CharWithBox[] = [];
          for (let i = 0; i < count; i++) {
            const code = this.api.FPDFText_GetUnicode(textPage, i);
            if (
              code <= 0 ||
              code > 0x10ffff ||
              (code >= 0xd800 && code <= 0xdfff)
            ) {
              continue;
            }

            const generated = this.api.FPDFText_IsGenerated(textPage, i) !== 0;
            let box = null;
            if (!generated) {
              const ok = this.api.FPDFText_GetCharBox(
                textPage,
                i,
                boxPtr,
                boxPtr + 8,
                boxPtr + 16,
                boxPtr + 24,
              );
              if (ok) {
                const [left, right, bottom, top] = this.heap.readDoubles(
                  boxPtr,
                  4,
                );
                if (
                  Number.isFinite(left) &&
                  Number.isFinite(right) &&
                  Number.isFinite(bottom) &&
                  Number.isFinite(top)
                ) {
                  box = { left, bottom, right, top };
                }
              }
            }

            result.push({
              char: String.fromCodePoint(code),
              generated,
              box,
            });
          }
          return result;
        });

        const { text, tokens } = tokenizePageChars(chars);
        return {
          pageIndex,
          text,
          tokens,
          hasText: tokens.length > 0,
          info,
        };
      } finally {
        this.api.FPDFText_ClosePage(textPage);
      }
    });
  }
}
