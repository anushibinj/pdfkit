import { applyToPoint } from "../../core/affine";
import {
  HIGHLIGHT_OPACITY,
  type BoxObject,
  type HighlightObject,
  type RectObject,
  type WhiteoutObject,
} from "../../core/model";
import { objectToUser } from "../../core/object-frame";
import { FILL_MODE } from "../pdfium-api";
import {
  check,
  insertNewObject,
  type ObjectWriter,
  type WriteContext,
} from "./object-writer";

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

/**
 * The box's area in user space as an axis-aligned rectangle
 * `[left, top, right, bottom]` (PDFium's `FS_RECTF` order).
 *
 * The box can be rotated by quarter turns, so its four local corners are
 * mapped to user space and the extremes taken; for quarter turns that is
 * exactly the box, with no slack.
 *
 * @param box The box object.
 * @returns The rectangle's edges in user space.
 */
export function userRect(box: BoxObject): [number, number, number, number] {
  const m = objectToUser(box);
  const corners = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: 0, y: box.height },
    { x: box.width, y: box.height },
  ].map((p) => applyToPoint(m, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)];
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

/**
 * Writes white-out boxes: deletes the original content under the box, then
 * paints the area white.
 */
export class WhiteoutWriter implements ObjectWriter<WhiteoutObject> {
  /**
   * Delete what the file already had under the box.
   *
   * `EPDFText_RedactInRect` is a real redaction, not a cover-up. Verified
   * against this PDFium build in `editor-session.integration.test.ts`:
   * - characters inside the rectangle are deleted (only those: the rest of a
   *   partly covered line survives);
   * - image pixels inside it are overwritten in the image data itself, so
   *   they cannot be extracted from the saved file;
   * - vector drawings inside it are removed too, while the parts of a
   *   drawing outside the rectangle stay.
   * Without this, white-out would only hide text visually, and anyone could
   * still copy the "hidden" text out of the PDF.
   *
   * It runs in the prepare pass, before the user's own objects are added,
   * so it only ever removes content that was in the original file.
   *
   * @param object The white-out box.
   * @param ctx The page being edited.
   */
  prepare(object: WhiteoutObject, ctx: WriteContext): void {
    const { api, heap } = ctx;
    heap.using(heap.floats(userRect(object)), (rect) => {
      // recurseForms: also redact inside form XObjects (reused content);
      // drawBlackBoxes: no, the box is painted white by `write`.
      api.EPDFText_RedactInRect(ctx.page, rect, true, false);
    });
  }

  /**
   * Paint the box white (covers vector drawings, which redaction only cuts
   * back, and keeps the look of the preview).
   *
   * @param object The white-out box.
   * @param ctx The page being edited.
   */
  write(object: WhiteoutObject, ctx: WriteContext): void {
    const { api } = ctx;
    insertBoxPath(ctx, object, (path) => {
      check(
        api.FPDFPageObj_SetFillColor(path, 255, 255, 255, 255),
        "set the white-out colour",
      );
      check(
        api.FPDFPath_SetDrawMode(path, FILL_MODE.WINDING, false),
        "fill the white-out",
      );
    });
  }
}
