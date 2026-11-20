import { compose } from "../../core/affine";
import type { TextObject } from "../../core/model";
import { objectToUser } from "../../core/object-frame";
import { STANDARD_FONT_NAME } from "../../core/standard-font-metrics";
import { layoutText, type FontMetricsSource } from "../../core/text-layout";
import {
  check,
  insertNewObject,
  type ObjectWriter,
  type WriteContext,
} from "./object-writer";

/**
 * Writes text objects as PDF text in a standard font (nothing embedded).
 *
 * PDFium text objects hold a single line, so each line becomes its own text
 * object, placed at the baseline computed by `layoutText` (the same function
 * the on-screen preview uses).
 */
export class TextWriter implements ObjectWriter<TextObject> {
  /** @param metrics Font metrics, for line positions. */
  constructor(private readonly metrics: FontMetricsSource) {}

  /**
   * Add one PDF text object per non-blank line.
   *
   * Coordinate chain for a glyph point (gx, gy):
   * - A PDF text object draws glyphs from its origin on the baseline, with
   *   y pointing up (glyph space).
   * - The object's local space has its origin at the top-left of the block
   *   and v pointing down, with this line's baseline at v = baseline. So
   *   (gx, gy) sits at local (gx, baseline - gy): the matrix
   *   [1, 0, 0, -1, 0, baseline].
   * - `objectToUser` then places local space on the page.
   * Composing both gives the text object's matrix. The two y flips cancel
   * out for an unrotated object, leaving glyphs upright.
   *
   * Lines that are only spaces would draw nothing visible and are skipped.
   *
   * @param object The text.
   * @param ctx The page being edited.
   */
  write(object: TextObject, ctx: WriteContext): void {
    const { api, heap } = ctx;
    const layout = layoutText(
      object.text,
      object.font,
      object.fontSize,
      this.metrics,
    );
    const toUser = objectToUser(object);
    const font = STANDARD_FONT_NAME[object.font];
    const { r, g, b } = object.color;
    layout.lines.forEach((line, i) => {
      if (line.trim() === "") return;
      insertNewObject(
        ctx,
        () => api.FPDFPageObj_NewTextObj(ctx.doc, font, object.fontSize),
        (text) => {
          heap.using(heap.utf16(line), (ptr) =>
            check(api.FPDFText_SetText(text, ptr), "set the text"),
          );
          check(
            api.FPDFPageObj_SetFillColor(text, r, g, b, 255),
            "set the text colour",
          );
        },
        compose(toUser, [1, 0, 0, -1, 0, layout.baselines[i]]),
        "a text object",
      );
    });
  }
}
