import type { Point } from "@/lib/affine";
import { check, insertNewObject } from "@/lib/pdfium/page-objects";
import type { TextSpec } from "../../core/model";
import { layoutTextBlock, type LineBounds } from "../../core/text-block";
import { standardFontName, textLines } from "../../core/text";
import {
  toAlpha,
  type Painter,
  type PainterContext,
  type PreparedContent,
} from "./painter";

/**
 * Draws text watermarks in a standard 14 font (nothing is embedded).
 *
 * A PDFium text object holds one line, so each line of the watermark
 * becomes its own text object. Lines are measured with PDFium itself
 * (`FPDFPageObj_GetBounds` on a temporary object), so the layout uses
 * exactly the glyph boxes that will be drawn.
 */
export class TextPainter implements Painter<TextSpec> {
  /**
   * Measure every line and lay them out as a centred block.
   *
   * @param content The validated text watermark.
   * @param opacity 0..1, applied to the text's fill colour.
   * @param ctx The document to draw into.
   * @returns The block's size (the same on every page) and how to draw it.
   */
  prepare(
    content: TextSpec,
    opacity: number,
    ctx: PainterContext,
  ): PreparedContent {
    const font = standardFontName(content.font, content.bold);
    const lines = textLines(content.text);
    const block = layoutTextBlock(
      lines.map((line) =>
        line.trim() === ""
          ? null
          : measureLine(ctx, font, content.fontSize, line),
      ),
      content.fontSize,
    );
    return {
      natural: block.size,
      sizeOn: () => block.size,
      draw: (page) =>
        lines.forEach((line, i) => {
          const origin = block.origins[i];
          if (origin)
            drawLine(ctx, page, font, content, toAlpha(opacity), line, origin);
        }),
    };
  }
}

/**
 * Measure the ink of one line: create a text object at the origin, read its
 * bounds and destroy it again (it never belongs to a page, so it is ours to
 * free, also when reading fails).
 *
 * @param ctx The document.
 * @param font Standard font name.
 * @param fontSize Size in points.
 * @param text The line.
 * @returns The line's ink box relative to its baseline origin.
 * @throws When PDFium cannot create, fill or measure the object.
 */
export function measureLine(
  ctx: PainterContext,
  font: string,
  fontSize: number,
  text: string,
): LineBounds {
  const { api, heap } = ctx;
  const object = api.FPDFPageObj_NewTextObj(ctx.doc, font, fontSize);
  if (!object) throw new Error("PDFium could not create a text object");
  try {
    heap.using(heap.utf16(text), (ptr) =>
      check(api.FPDFText_SetText(object, ptr), "set the text"),
    );
    // FPDFPageObj_GetBounds writes four floats: left, bottom, right, top.
    const [left, bottom, right, top] = heap.using(heap.alloc(16), (ptr) => {
      check(
        api.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12),
        "measure the text",
      );
      return heap.readFloats(ptr, 4);
    });
    return { left, bottom, right, top };
  } finally {
    api.FPDFPageObj_Destroy(object);
  }
}

/**
 * Add one line of the watermark to a page.
 *
 * @param ctx The document.
 * @param page The loaded page.
 * @param font Standard font name.
 * @param content The text watermark (size and colour).
 * @param alpha 0..255.
 * @param text The line.
 * @param origin Where the line's baseline starts.
 */
function drawLine(
  ctx: PainterContext,
  page: number,
  font: string,
  content: TextSpec,
  alpha: number,
  text: string,
  origin: Point,
): void {
  const { api, heap } = ctx;
  const { r, g, b } = content.color;
  insertNewObject(
    { api, page },
    () => api.FPDFPageObj_NewTextObj(ctx.doc, font, content.fontSize),
    (object) => {
      heap.using(heap.utf16(text), (ptr) =>
        check(api.FPDFText_SetText(object, ptr), "set the text"),
      );
      check(
        api.FPDFPageObj_SetFillColor(object, r, g, b, alpha),
        "set the text colour",
      );
    },
    [1, 0, 0, 1, origin.x, origin.y],
    "a text object",
  );
}
