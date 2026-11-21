import type { Size } from "@/lib/pdfium/page-box";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { WatermarkSpec } from "../../core/model";
import type { WatermarkPdfiumApi } from "../watermark-pdfium-api";

/** The validated content of a watermark (text or picture). */
export type ContentSpec = WatermarkSpec["content"];

/** What a painter needs to draw into a document. */
export interface PainterContext {
  api: WatermarkPdfiumApi;
  heap: WasmHeap;
  /** The `FPDF_DOCUMENT` the content is drawn into. */
  doc: number;
}

/**
 * Content ready to be drawn: measured once, drawn once, then reused for
 * every copy as a form XObject (see `StampBuilder`).
 */
export interface PreparedContent {
  /**
   * Size of the page the content is drawn on, in points. The drawing fills
   * the box from (0, 0) to this size, which becomes the form XObject's box.
   */
  natural: Size;
  /**
   * Size one copy should have on a page.
   *
   * @param page The page's displayed size.
   * @returns The copy's unrotated size in points.
   */
  sizeOn(page: Size): Size;
  /**
   * Draw the content, with its opacity, filling its {@link natural} box.
   *
   * @param page A loaded `FPDF_PAGE` of size {@link natural}.
   */
  draw(page: number): void;
}

/** Prepares one kind of watermark content for drawing. */
export interface Painter<T extends ContentSpec> {
  /**
   * Measure the content and return how to draw it.
   *
   * Opacity is applied here, to the drawn objects themselves, and not to
   * the copies that reference them: PDFium starts every generated content
   * stream with its own graphics state (/ca 1), which inside a form XObject
   * would reset an opacity set outside it (checked against the real
   * WebAssembly build).
   *
   * @param content The validated content.
   * @param opacity 0..1.
   * @param ctx The document to draw into.
   * @returns The prepared content.
   */
  prepare(content: T, opacity: number, ctx: PainterContext): PreparedContent;
}

/** One painter per content kind, typed so each gets only its own kind. */
export type PainterRegistry = {
  [K in ContentSpec["kind"]]: Painter<Extract<ContentSpec, { kind: K }>>;
};

/**
 * The painter for a content. The cast is safe because the registry's type
 * pairs every kind with a painter for exactly that kind.
 *
 * @param registry All painters.
 * @param content Any content.
 * @returns Its painter.
 */
export function painterFor(
  registry: PainterRegistry,
  content: ContentSpec,
): Painter<ContentSpec> {
  return registry[content.kind] as Painter<ContentSpec>;
}

/**
 * Convert an opacity to PDFium's 8-bit alpha.
 *
 * @param opacity 0..1 (clamped).
 * @returns 0..255, rounded.
 */
export function toAlpha(opacity: number): number {
  return Math.round(255 * Math.min(1, Math.max(0, opacity)));
}
