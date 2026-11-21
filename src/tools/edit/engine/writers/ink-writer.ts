import type { InkObject } from "../../core/model";
import { objectToUser } from "../../core/object-frame";
import { FILL_MODE, ROUND } from "../pdfium-api";
import { check, insertNewObject } from "@/lib/pdfium/page-objects";
import type { ObjectWriter, WriteContext } from "./object-writer";

/** Writes freehand strokes as stroked PDF paths with round ends and joins. */
export class InkWriter implements ObjectWriter<InkObject> {
  /**
   * Add the stroke as one path in local coordinates, placed on the page by
   * the object's frame. The frame never scales, so the pen width written in
   * the path is the width the user chose.
   *
   * A single tap gives a one-point stroke, which as a path would have no
   * length and draw nothing. Repeating the point makes a zero-length
   * segment; with round caps PDF readers draw it as a dot, matching the
   * on-screen preview.
   *
   * @param object The stroke.
   * @param ctx The page being edited.
   */
  write(object: InkObject, ctx: WriteContext): void {
    const { api } = ctx;
    const [first, ...rest] = object.points;
    const { r, g, b } = object.color;
    insertNewObject(
      ctx,
      () => api.FPDFPageObj_CreateNewPath(first.x, first.y),
      (path) => {
        for (const p of rest.length > 0 ? rest : [first]) {
          check(api.FPDFPath_LineTo(path, p.x, p.y), "draw the stroke");
        }
        check(
          api.FPDFPageObj_SetStrokeColor(path, r, g, b, 255),
          "set the pen colour",
        );
        check(
          api.FPDFPageObj_SetStrokeWidth(path, object.strokeWidth),
          "set the pen width",
        );
        check(api.FPDFPageObj_SetLineCap(path, ROUND), "round the stroke ends");
        check(
          api.FPDFPageObj_SetLineJoin(path, ROUND),
          "round the stroke corners",
        );
        check(
          api.FPDFPath_SetDrawMode(path, FILL_MODE.NONE, true),
          "stroke the path",
        );
      },
      objectToUser(object),
      "a pen stroke",
    );
  }
}
