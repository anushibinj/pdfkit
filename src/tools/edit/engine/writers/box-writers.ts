import {
  HIGHLIGHT_OPACITY,
  type BoxObject,
  type HighlightObject,
  type RectObject,
} from "../../core/model";
import { objectToUser } from "../../core/object-frame";
import { FILL_MODE } from "../pdfium-api";
import { check, insertNewObject } from "@/lib/pdfium/page-objects";
import type { ObjectWriter, WriteContext } from "./object-writer";

/**
 * Add a rectangle path covering a box's local area [0, width] x [0, height],
 * configured by `configure` and placed by the box's frame.
 *
 * @param ctx The page being edited.
 * @param box The box object.
 * @param configure Sets colours and the draw mode.
 */
function insertBoxPath(
  ctx: WriteContext,
  box: BoxObject,
  configure: (path: number) => void,
): void {
  insertNewObject(
    ctx,
    () => ctx.api.FPDFPageObj_CreateNewRect(0, 0, box.width, box.height),
    configure,
    objectToUser(box),
    "a rectangle",
  );
}

/** Writes outlined rectangles. */
export class RectWriter implements ObjectWriter<RectObject> {
  /**
   * Add the outline. The stroke is centred on the box edge, as SVG draws it
   * in the preview.
   *
   * @param object The rectangle.
   * @param ctx The page being edited.
   */
  write(object: RectObject, ctx: WriteContext): void {
    const { api } = ctx;
    const { r, g, b } = object.color;
    insertBoxPath(ctx, object, (path) => {
      check(
        api.FPDFPageObj_SetStrokeColor(path, r, g, b, 255),
        "set the outline colour",
      );
      check(
        api.FPDFPageObj_SetStrokeWidth(path, object.strokeWidth),
        "set the outline width",
      );
      check(
        api.FPDFPath_SetDrawMode(path, FILL_MODE.NONE, true),
        "outline the rectangle",
      );
    });
  }
}

/** Writes translucent highlight rectangles. */
export class HighlightWriter implements ObjectWriter<HighlightObject> {
  /**
   * Add a filled rectangle at {@link HIGHLIGHT_OPACITY} with the "Multiply"
   * blend mode. Multiply darkens only: on white paper it shows the marker
   * colour, while black text underneath stays black instead of being
   * washed out, which is how a real highlighter looks.
   *
   * @param object The highlight.
   * @param ctx The page being edited.
   */
  write(object: HighlightObject, ctx: WriteContext): void {
    const { api } = ctx;
    const { r, g, b } = object.color;
    const alpha = Math.round(255 * HIGHLIGHT_OPACITY);
    insertBoxPath(ctx, object, (path) => {
      check(
        api.FPDFPageObj_SetFillColor(path, r, g, b, alpha),
        "set the highlight colour",
      );
      check(
        api.FPDFPath_SetDrawMode(path, FILL_MODE.WINDING, false),
        "fill the highlight",
      );
      api.FPDFPageObj_SetBlendMode(path, "Multiply");
    });
  }
}
