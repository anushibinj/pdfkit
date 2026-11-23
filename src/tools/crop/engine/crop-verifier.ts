import { compose, type Matrix } from "@/lib/affine";
import { userToView, viewSize } from "@/lib/pdfium/page-box";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { CropPlan } from "../core/crop-plan";
import { verifyPage, type VerifyFailure } from "../core/verify";
import type { CropPdfiumApi } from "./crop-pdfium-api";
import { readPageChars } from "./page-chars";

/** Longest side of the bitmaps compared, in pixels. */
export const CHECK_MAX_SIDE = 1600;
/** Most pixels per point used for the comparison. */
export const CHECK_MAX_SCALE = 2;

/** The result changed something inside the crop area of a page. */
export class CropVerificationError extends Error {
  /**
   * @param pageIndex The 0-based page.
   * @param failure What changed.
   */
  constructor(
    readonly pageIndex: number,
    readonly failure: VerifyFailure,
  ) {
    super(`Page ${pageIndex + 1}: ${failure.message}.`);
    this.name = "CropVerificationError";
  }
}

/**
 * Checks, with PDFium, that a crop with "remove what's outside" left the
 * crop area of every page as it was (see `core/verify.ts` for what is
 * compared and why).
 */
export class CropVerifier {
  /**
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   */
  constructor(
    private readonly api: CropPdfiumApi,
    private readonly heap: WasmHeap,
  ) {}

  /**
   * Compare every cropped page of the result with the original.
   *
   * For each page: render the original with its CropBox set (in memory) to
   * the crop area, and the result as it is, at the same size, so both
   * bitmaps show the same area on the same pixel grid; read both pages'
   * characters; and compare. The two documents are opened only for this
   * check and always closed.
   *
   * @param original The file before cropping.
   * @param result The cropped file.
   * @param plan The plan the result was made with (sanitised).
   * @param maxTextShift The module's bound on text movement in PDFium.
   * @param onProgress Told the fraction of pages checked (0..1).
   * @throws {CropVerificationError} For the first page that differs.
   * @throws {PdfOpenError} When the result cannot be opened.
   */
  verify(
    original: Uint8Array,
    result: Uint8Array,
    plan: CropPlan,
    maxTextShift: number,
    onProgress?: (fraction: number) => void,
  ): void {
    const before = PdfiumDocument.open(this.api, this.heap, original, "");
    try {
      const after = PdfiumDocument.open(this.api, this.heap, result, "");
      try {
        plan.pages.forEach(({ pageIndex, rect }, done) => {
          const failure = this.comparePage(
            before,
            after,
            pageIndex,
            rect,
            maxTextShift,
          );
          if (failure) throw new CropVerificationError(pageIndex, failure);
          onProgress?.((done + 1) / plan.pages.length);
        });
      } finally {
        after.close();
      }
    } finally {
      before.close();
    }
  }

  /**
   * Render and read one page of both documents and compare them.
   *
   * @param before The original document.
   * @param after The cropped document.
   * @param pageIndex The page.
   * @param crop The crop area in user space.
   * @param maxTextShift The module's bound on text movement.
   * @returns What differs, or `null`.
   */
  private comparePage(
    before: PdfiumDocument,
    after: PdfiumDocument,
    pageIndex: number,
    crop: CropPlan["pages"][number]["rect"],
    maxTextShift: number,
  ): VerifyFailure | null {
    const { rotation } = before.pageInfo(pageIndex);
    const view = viewSize(crop, rotation);
    const scale = Math.min(
      CHECK_MAX_SCALE,
      CHECK_MAX_SIDE / Math.max(view.width, view.height),
    );
    const width = Math.max(1, Math.round(view.width * scale));
    const height = Math.max(1, Math.round(view.height * scale));
    // PDFium stretches the page to the bitmap, so each axis has its own
    // scale after rounding to whole pixels.
    const toPixel: Matrix = compose(
      [width / view.width, 0, 0, height / view.height, 0, 0],
      userToView(crop, rotation),
    );
    const beforePixels = before.render(pageIndex, width, height, 0, (page) =>
      this.api.FPDFPage_SetCropBox(
        page,
        crop.left,
        crop.bottom,
        crop.right,
        crop.top,
      ),
    ).pixels;
    const afterPixels = after.render(pageIndex, width, height, 0).pixels;
    const read = (doc: PdfiumDocument) =>
      doc.withPage(pageIndex, (page) =>
        readPageChars(this.api, this.heap, page),
      );
    return verifyPage({
      crop,
      before: { chars: read(before), pixels: beforePixels },
      after: { chars: read(after), pixels: afterPixels },
      width,
      height,
      toPixel,
      maxTextShift,
      scale,
    });
  }
}
