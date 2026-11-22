import { viewSize } from "@/lib/geometry/page-geometry";
import {
  PdfOpenError,
  PdfiumDocument,
  type PageInfo,
  type RenderedPage,
} from "@/lib/pdfium/pdfium-document";
import { fitRenderSize } from "@/lib/pdfium/render-size";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { encodeCropPlan, sanitizeCropPlan } from "../core/crop-plan";
import { parseCropReport, type CropReport } from "../core/report";
import type { CropPdfiumApi } from "./crop-pdfium-api";
import { CropVerifier } from "./crop-verifier";
import type { PdfCropModule } from "./pdf-crop-module";

/**
 * The file is encrypted (with or without a password to open it). Cropping
 * would have to drop its protection, so it is refused; the PDF Unlocker can
 * remove the protection first.
 */
export class EncryptedPdfError extends Error {
  constructor() {
    super(
      "This PDF is protected. Remove its protection with the PDF Unlocker first, then crop it.",
    );
    this.name = "EncryptedPdfError";
  }
}

/** The pdf-crop module refused the job; `code` says why (see `error.rs`). */
export class CropModuleError extends Error {
  /**
   * @param code The module's error code.
   * @param message The module's explanation.
   */
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CropModuleError";
  }
}

/** A finished crop. */
export interface CropOutcome {
  /** The cropped PDF. */
  pdf: Uint8Array;
  report: CropReport;
  /** Whether the result was checked page by page (only when removing). */
  verified: boolean;
}

/** Progress stages reported by {@link CropSession.crop}. */
export type CropStage = "cropping" | "checking";

/**
 * The worker's state for one opened PDF.
 *
 * - PDFium shows the pages (a "view" document kept open while the file is)
 *   and, after a crop that removes content, checks the result.
 * - The pdf-crop module does the cropping. It is loaded only when the
 *   first crop is asked for, so opening and previewing never download it.
 *
 * The original bytes are kept so every crop starts from the untouched file.
 */
export class CropSession {
  private readonly heap: WasmHeap;
  private readonly verifier: CropVerifier;
  private view: PdfiumDocument | null = null;
  private source: Uint8Array | null = null;
  private pages: PageInfo[] = [];

  /**
   * @param api The initialised PDFium module.
   * @param loadCropModule Loads the pdf-crop module (memoised by the caller).
   */
  constructor(
    private readonly api: CropPdfiumApi,
    private readonly loadCropModule: () => Promise<PdfCropModule>,
  ) {
    this.heap = new WasmHeap(api.pdfium);
    this.verifier = new CropVerifier(api, this.heap);
  }

  /**
   * Open a file, replacing any open one.
   *
   * Encrypted files are refused, both those that need a password (PDFium
   * reports a password error) and those that open without one but carry
   * restrictions (they have a security handler).
   *
   * @param bytes The PDF file.
   * @returns Every page's box and rotation.
   * @throws {EncryptedPdfError} For encrypted files.
   * @throws {PdfOpenError} When the file is not a readable PDF.
   */
  open(bytes: Uint8Array): PageInfo[] {
    this.close();
    let view: PdfiumDocument;
    try {
      view = PdfiumDocument.open(this.api, this.heap, bytes, "");
    } catch (err) {
      if (err instanceof PdfOpenError && err.reason === "password") {
        throw new EncryptedPdfError();
      }
      throw err;
    }
    try {
      if (this.api.FPDF_GetSecurityHandlerRevision(view.handle) !== -1) {
        throw new EncryptedPdfError();
      }
      const count = view.pageCount();
      if (count < 1) throw new Error("This PDF has no pages.");
      this.pages = Array.from({ length: count }, (_, i) => view.pageInfo(i));
    } catch (err) {
      view.close();
      throw err;
    }
    this.view = view;
    this.source = bytes;
    return this.pages;
  }

  /**
   * Render a page as it is displayed (its own rotation applied).
   *
   * @param pageIndex 0-based page.
   * @param width Requested bitmap width in pixels.
   * @returns RGBA pixels; the size comes from `fitRenderSize`.
   * @throws When nothing is open or the page does not exist.
   */
  render(pageIndex: number, width: number): RenderedPage {
    const view = this.requireView();
    const info = this.requirePage(pageIndex);
    const size = fitRenderSize(viewSize(info.box, info.rotation), width);
    return view.render(pageIndex, size.width, size.height, 0);
  }

  /**
   * Crop the open file.
   *
   * 1. Check the plan (it crossed a thread boundary).
   * 2. Load the pdf-crop module (first time only) and crop a copy of the
   *    original bytes.
   * 3. When content was removed, check every cropped page against the
   *    original with PDFium, and refuse the result if anything inside the
   *    crop area changed.
   *
   * @param rawPlan The plan from the UI (untrusted).
   * @param onProgress Told the stage and its fraction done.
   * @returns The cropped file and its report.
   * @throws {InvalidCropPlanError}, {CropModuleError} or
   *   {CropVerificationError}.
   */
  async crop(
    rawPlan: unknown,
    onProgress?: (stage: CropStage, fraction: number) => void,
  ): Promise<CropOutcome> {
    this.requireView();
    const source = this.source!;
    const plan = sanitizeCropPlan(rawPlan, this.pages.length);
    onProgress?.("cropping", 0);
    const cropper = await this.loadCropModule();
    const outcome = cropper.crop(source, encodeCropPlan(plan));
    if (!outcome.ok) throw new CropModuleError(outcome.code, outcome.message);
    const report = parseCropReport(outcome.report);
    onProgress?.("cropping", 1);
    if (plan.removeOutside) {
      onProgress?.("checking", 0);
      this.verifier.verify(
        source,
        outcome.pdf,
        plan,
        report.maxTextShift,
        (f) => onProgress?.("checking", f),
      );
    }
    return { pdf: outcome.pdf, report, verified: plan.removeOutside };
  }

  /** Close the file and forget its bytes. Safe to call when closed. */
  close(): void {
    this.view?.close();
    this.view = null;
    this.source = null;
    this.pages = [];
  }

  /**
   * @param pageIndex 0-based page.
   * @returns The page's box and rotation.
   * @throws When the page does not exist.
   */
  private requirePage(pageIndex: number): PageInfo {
    const info = this.pages[pageIndex];
    if (!info) throw new Error(`There is no page ${pageIndex + 1}.`);
    return info;
  }

  /**
   * @returns The view document.
   * @throws When no document is open.
   */
  private requireView(): PdfiumDocument {
    if (!this.view) throw new Error("No PDF is open.");
    return this.view;
  }
}
