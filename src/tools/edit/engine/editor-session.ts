import type { PageInfo, QuarterTurns } from "../core/model";
import { addTurns, viewSize, type Size } from "../core/page-geometry";
import { sanitizeSavePlan } from "../core/sanitize-plan";
import type { FontMetricsSource } from "../core/text-layout";
import { applySavePlan } from "./apply-plan";
import type { PdfiumApi } from "./pdfium-api";
import { PdfiumDocument, type RenderedPage } from "./pdfium-document";
import { WasmHeap } from "./wasm-heap";
import { createWriterRegistry, type WriterRegistry } from "./writers/registry";

/** Widest page bitmap the worker renders, in pixels. */
export const MAX_RENDER_WIDTH = 4096;
/** Most pixels in one page bitmap (64 MB of RGBA). */
export const MAX_RENDER_PIXELS = 16_000_000;

/**
 * Pixel size for rendering a page at a requested width.
 *
 * The height follows the displayed page's aspect ratio. The width is
 * clamped to 1..{@link MAX_RENDER_WIDTH}, and if a very tall page would
 * still exceed {@link MAX_RENDER_PIXELS}, both sides shrink by the same
 * factor (the square root of the excess, since area scales with the square
 * of the side) so the shape is kept.
 *
 * @param view The displayed page size in points.
 * @param requestedWidth Desired bitmap width in pixels.
 * @returns Whole-pixel width and height, each at least 1.
 */
export function fitRenderSize(view: Size, requestedWidth: number): Size {
  const width = Math.min(
    MAX_RENDER_WIDTH,
    Math.max(1, Math.round(requestedWidth) || 1),
  );
  const aspect = view.width > 0 ? view.height / view.width : 1;
  let w = width;
  let h = Math.max(1, Math.round(width * aspect));
  if (w * h > MAX_RENDER_PIXELS) {
    const shrink = Math.sqrt(MAX_RENDER_PIXELS / (w * h));
    w = Math.max(1, Math.floor(w * shrink));
    h = Math.max(1, Math.floor(h * shrink));
  }
  return { width: w, height: h };
}

/**
 * The worker's state for one opened PDF.
 *
 * It keeps two things:
 * - a "view" document, never edited, used to render pages for the screen;
 *   the user's edits are drawn over those renders by the browser;
 * - the original file bytes and password, so that saving can open a fresh
 *   copy, apply every edit to it, save it and throw it away. Saving twice
 *   therefore never applies an edit twice, and the view stays pristine.
 */
export class EditorSession {
  private readonly heap: WasmHeap;
  private readonly writers: WriterRegistry;
  private view: PdfiumDocument | null = null;
  private source: { bytes: Uint8Array; password: string } | null = null;
  private pages: PageInfo[] = [];

  /**
   * @param api The initialised PDFium module.
   * @param metrics Font metrics (for text and for sanitising plans).
   */
  constructor(
    private readonly api: PdfiumApi,
    private readonly metrics: FontMetricsSource,
  ) {
    this.heap = new WasmHeap(api.pdfium);
    this.writers = createWriterRegistry(metrics);
  }

  /** @returns Whether a document is open. */
  isOpen(): boolean {
    return this.view !== null;
  }

  /**
   * Open a file, replacing any open one.
   *
   * @param bytes The PDF file.
   * @param password The user password, or "" for none.
   * @returns Every page's box and rotation.
   * @throws {PdfOpenError} When the file cannot be opened.
   */
  open(bytes: Uint8Array, password: string): PageInfo[] {
    this.close();
    const view = PdfiumDocument.open(this.api, this.heap, bytes, password);
    try {
      const count = view.pageCount();
      if (count < 1) throw new Error("This PDF has no pages.");
      this.pages = Array.from({ length: count }, (_, i) => view.pageInfo(i));
    } catch (err) {
      view.close();
      throw err;
    }
    this.view = view;
    this.source = { bytes, password };
    return this.pages;
  }

  /**
   * Render one page of the unedited document.
   *
   * @param pageIndex Source page index.
   * @param turns Clockwise quarter turns the user added.
   * @param width Requested bitmap width in pixels.
   * @returns RGBA pixels (size from {@link fitRenderSize}).
   * @throws When nothing is open or the index is out of range.
   */
  render(pageIndex: number, turns: QuarterTurns, width: number): RenderedPage {
    const view = this.requireView();
    const info = this.pages[pageIndex];
    if (!info) throw new Error(`There is no page ${pageIndex + 1}.`);
    const size = fitRenderSize(
      viewSize(info.box, addTurns(info.rotation, turns)),
      width,
    );
    return view.render(pageIndex, size.width, size.height, turns);
  }

  /**
   * Produce the edited file.
   *
   * The plan is sanitised first (it crossed a thread boundary), then applied
   * to a fresh copy opened from the original bytes. That copy is always
   * closed, whether saving worked or not.
   *
   * @param rawPlan The save plan from the UI (untrusted).
   * @returns The edited PDF's bytes.
   * @throws {InvalidPlanError} or a PDFium failure.
   */
  save(rawPlan: unknown): Uint8Array {
    this.requireView();
    const source = this.source!;
    const plan = sanitizeSavePlan(rawPlan, this.pages.length, this.metrics);
    const doc = PdfiumDocument.open(
      this.api,
      this.heap,
      source.bytes,
      source.password,
    );
    try {
      applySavePlan(doc, plan, {
        api: this.api,
        heap: this.heap,
        writers: this.writers,
      });
      return doc.save();
    } finally {
      doc.close();
    }
  }

  /** Close the open document and forget its bytes. Safe to call when closed. */
  close(): void {
    this.view?.close();
    this.view = null;
    this.source = null;
    this.pages = [];
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
