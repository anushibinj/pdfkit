import { compose } from "@/lib/affine";
import type { ImageObject } from "../../core/model";
import { objectToUser } from "../../core/object-frame";
import {
  insertNewObject,
  type ObjectWriter,
  type WriteContext,
} from "./object-writer";

/** Writes PNG and JPEG pictures as PDF image objects. */
export class ImageWriter implements ObjectWriter<ImageObject> {
  /**
   * Embed the picture and stretch it over the object's box.
   *
   * - PNG: PDFium decodes it and stores it compressed, keeping transparency
   *   as a soft mask, so a signature on a transparent background does not
   *   paint a white rectangle over the page.
   * - JPEG: the file is embedded as-is (DCTDecode), with no quality loss.
   * PDFium copies the bytes, so our copy is freed right after the call.
   *
   * Placement: a PDF image always fills the unit square from (0, 0) to
   * (1, 1), with its top row at y = 1. Local space has the top-left at
   * (0, 0) and v pointing down, so an image point (ix, iy) belongs at local
   * (ix * width, (1 - iy) * height), the matrix [w, 0, 0, -h, 0, h].
   * `objectToUser` then places local space on the page.
   *
   * @param object The image object.
   * @param ctx The page being edited.
   * @throws When the image bytes are missing or cannot be decoded.
   */
  write(object: ImageObject, ctx: WriteContext): void {
    const { api, heap } = ctx;
    const image = ctx.images.get(object.imageId);
    if (!image) throw new Error("An added image is missing. Add it again.");
    const bytes = new Uint8Array(image.bytes);
    insertNewObject(
      ctx,
      () => api.FPDFPageObj_NewImageObj(ctx.doc),
      (handle) => {
        const ok = heap.using(heap.copyIn(bytes), (ptr) =>
          image.mime === "image/png"
            ? api.EPDFImageObj_SetPng(ctx.page, 0, handle, ptr, bytes.length)
            : api.EPDFImageObj_SetJpeg(ctx.page, 0, handle, ptr, bytes.length),
        );
        if (!ok)
          throw new Error(
            "An added image could not be read. Use a PNG or JPEG file.",
          );
      },
      compose(objectToUser(object), [
        object.width,
        0,
        0,
        -object.height,
        0,
        object.height,
      ]),
      "an image",
    );
  }
}
