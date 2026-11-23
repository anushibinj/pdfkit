import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { RedactionMark, VerificationReport } from "../core/model";
import type { PageCharWithBox } from "../core/text-search";
import { verifyRedactedOutput } from "../core/verify";
import { readPageCharsWithBoxes } from "./page-text-extractor";
import type { RedactPdfiumApi } from "./redact-pdfium-api";

/**
 * Error thrown when post-save verification detects that one or more redacted
 * terms or covered glyphs still exist in the reopened output PDF.
 *
 * Callers must refuse to offer the output PDF for download whenever this error
 * is thrown.
 */
export class RedactionVerificationError extends Error {
  /**
   * @param report Full verification breakdown including leaked terms and summary.
   */
  constructor(readonly report: VerificationReport) {
    super(
      `Verification failed (${report.summary}). The redacted PDF was withheld because sensitive text remained.`,
    );
    this.name = "RedactionVerificationError";
  }
}

/**
 * Reopens the saved output PDF in a fresh PDFium document, re-extracts all
 * text across every page, and verifies that zero redacted terms remain.
 */
export class RedactionVerifier {
  /**
   * @param api PDFium module interface.
   * @param heap WASM heap helper.
   */
  constructor(
    private readonly api: RedactPdfiumApi,
    private readonly heap: WasmHeap,
  ) {}

  /**
   * Reopen `outputPdfBytes`, extract all text, and run {@link verifyRedactedOutput}.
   *
   * @param outputPdfBytes Final saved PDF bytes offered to the user.
   * @param allMarks All marks from the plan (enabled and disabled).
   * @param overlayLabel Label text drawn inside redaction boxes.
   * @param onProgress Optional callback receiving `0..1` fraction per page.
   * @returns Verified {@link VerificationReport} when zero redacted terms remain.
   * @throws {RedactionVerificationError} When any redacted term or glyph remains.
   */
  verify(
    outputPdfBytes: Uint8Array,
    allMarks: readonly RedactionMark[],
    overlayLabel: string,
    onProgress?: (fraction: number) => void,
  ): VerificationReport {
    const doc = PdfiumDocument.open(this.api, this.heap, outputPdfBytes, "");
    try {
      const pageCount = doc.pageCount();
      const reopenedPages: PageCharWithBox[][] = [];
      for (let i = 0; i < pageCount; i++) {
        const chars = doc.withPage(i, (page) =>
          readPageCharsWithBoxes(this.api, this.heap, page),
        );
        reopenedPages.push(chars);
        onProgress?.((i + 1) / Math.max(1, pageCount));
      }

      const report = verifyRedactedOutput({
        allMarks,
        overlayLabel,
        reopenedPages,
        outputPdfBytes,
      });
      if (!report.verified) {
        throw new RedactionVerificationError(report);
      }
      return report;
    } finally {
      doc.close();
    }
  }
}
