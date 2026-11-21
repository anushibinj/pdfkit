import type { PageInfo, QuarterTurns, TextEditOutcome } from "../core/model";
import { viewSize, type Size } from "@/lib/pdfium/page-box";
import { addTurns } from "../core/page-geometry";
import { sanitizeSavePlan, sanitizeTextEdits } from "../core/sanitize-plan";
import type { FontMetricsSource } from "../core/text-layout";
import { groupFragments, type TextRun } from "../core/text-runs";
import { applySavePlan } from "./apply-plan";
import { PdfiumPageText } from "./page-text";
import type { PdfiumApi } from "./pdfium-api";
import {
  PdfiumDocument,
  type RenderedPage,
} from "@/lib/pdfium/pdfium-document";
import { applyTextEdits } from "./text-edits";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
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

/** A rendered page and what happened to each text edit shown on it. */
export interface PageRender extends RenderedPage {
  textOutcomes: TextEditOutcome[];
}

/**
 * The worker's state for one opened PDF.
 *
 * It keeps two things:
 * - a "view" document, never saved, used to render pages for the screen.
 *   Text edits are applied to a page only while it is loaded for one
 *   render (so the preview is exactly what saving produces) and dropped
 *   when it closes; added objects are drawn over the render by the browser;
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
   * List the editable lines of text on a page, as the original file has
   * them.
   *
   * @param pageIndex Source page index.
   * @returns The lines, in content order.
   * @throws When nothing is open or the index is out of range.
   */
  textRuns(pageIndex: number): TextRun[] {
    const view = this.requireView();
    this.requirePage(pageIndex);
    return view.withPage(pageIndex, (page) =>
      groupFragments(
        new PdfiumPageText(this.api, this.heap, view.handle, page).read()
          .fragments,
      ),
    );
  }

  /**
   * Render one page, with text edits applied for this render only.
   *
   * The edits run through the same code as saving (`applyTextEdits`), on
   * the page loaded for this render, so the preview shows exactly the
   * fonts and characters the saved file will have. They are not written
   * back: the page is closed without regenerating its content.
   *
   * @param pageIndex Source page index.
   * @param turns Clockwise quarter turns the user added.
   * @param width Requested bitmap width in pixels.
   * @param rawTextEdits Text edits for this page (untrusted: sanitised).
   * @returns RGBA pixels (size from {@link fitRenderSize}) and one outcome
   *   per text edit.
   * @throws When nothing is open or the index is out of range.
   */
  render(
    pageIndex: number,
    turns: QuarterTurns,
    width: number,
    rawTextEdits: unknown = [],
  ): PageRender {
    const view = this.requireView();
    const info = this.requirePage(pageIndex);
    const edits = sanitizeTextEdits(rawTextEdits);
    const size = fitRenderSize(
      viewSize(info.box, addTurns(info.rotation, turns)),
      width,
    );
    let textOutcomes: TextEditOutcome[] = [];
    const rendered = view.render(
      pageIndex,
      size.width,
      size.height,
      turns,
      edits.length === 0
        ? undefined
        : (page) => {
            textOutcomes = applyTextEdits(
              new PdfiumPageText(this.api, this.heap, view.handle, page),
              edits,
              this.metrics,
            );
          },
    );
    return { ...rendered, textOutcomes };
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
        metrics: this.metrics,
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
   * @param pageIndex Source page index.
   * @returns The page's box and rotation.
   * @throws When the index is out of range.
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
