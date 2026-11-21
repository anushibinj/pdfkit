import type { Size } from "@/lib/pdfium/page-box";
import { check, insertNewObject } from "@/lib/pdfium/page-objects";
import type { ImageSpec } from "../../core/model";
import {
  toAlpha,
  type Painter,
  type PainterContext,
  type PreparedContent,
} from "./painter";

/**
 * Longer side of the page a picture is drawn on, in points. The picture is
 * scaled for each page by its copy's matrix, so this only has to keep the
 * aspect ratio; a fixed size keeps the page within PDF's 14,400 pt limit
 * whatever the picture's pixel count.
 */
export const IMAGE_NATURAL_SIDE = 1000;

/**
 * The box a picture is drawn into: its aspect ratio, longer side
 * {@link IMAGE_NATURAL_SIDE}.
 *
 * @param pixelWidth Picture width in pixels (> 0).
 * @param pixelHeight Picture height in pixels (> 0).
 * @returns The box in points.
 */
export function imageNaturalSize(
  pixelWidth: number,
  pixelHeight: number,
): Size {
  const longer = Math.max(pixelWidth, pixelHeight);
  return {
    width: (IMAGE_NATURAL_SIDE * pixelWidth) / longer,
    height: (IMAGE_NATURAL_SIDE * pixelHeight) / longer,
  };
}

/**
 * Size of one picture copy on a page: `scale` times the page's displayed
 * width, height following the picture's aspect ratio.
 *
 * @param image The validated picture.
 * @param page The page's displayed size.
 * @returns The copy's size in points.
 */
export function imageSizeOn(image: ImageSpec, page: Size): Size {
  const width = image.scale * page.width;
  return { width, height: (width * image.pixelHeight) / image.pixelWidth };
}

/** Draws PNG and JPEG watermarks. */
export class ImagePainter implements Painter<ImageSpec> {
  /**
   * Prepare a picture for drawing.
   *
   * The picture is embedded once (in the form XObject that every copy
   * shares), not once per copy, which matters when it is tiled.
   *
   * @param content The validated picture.
   * @param opacity 0..1, applied to the image object.
   * @param ctx The document to draw into.
   * @returns How to draw it and how big each copy is.
   */
  prepare(
    content: ImageSpec,
    opacity: number,
    ctx: PainterContext,
  ): PreparedContent {
    const natural = imageNaturalSize(content.pixelWidth, content.pixelHeight);
    return {
      natural,
      sizeOn: (page) => imageSizeOn(content, page),
      draw: (page) => drawImage(ctx, page, content, toAlpha(opacity), natural),
    };
  }
}

/**
 * Embed the picture and stretch it over the natural box.
 *
 * - PNG: PDFium decodes it and keeps transparency as a soft mask, so a logo
 *   on a transparent background does not paint a rectangle.
 * - JPEG: embedded as is (DCTDecode), without quality loss.
 * PDFium copies the bytes, so our copy is freed right after the call.
 * A PDF image fills the unit square, so the matrix [w, 0, 0, h, 0, 0]
 * stretches it over the box. The alpha goes on the image object; PDFium
 * writes it as an ExtGState (/ca) in front of the image.
 *
 * @param ctx The document.
 * @param page The loaded page.
 * @param image The picture.
 * @param alpha 0..255.
 * @param box The natural box.
 * @throws When PDFium cannot decode the picture.
 */
function drawImage(
  ctx: PainterContext,
  page: number,
  image: ImageSpec,
  alpha: number,
  box: Size,
): void {
  const { api, heap } = ctx;
  insertNewObject(
    { api, page },
    () => api.FPDFPageObj_NewImageObj(ctx.doc),
    (object) => {
      const ok = heap.using(heap.copyIn(image.bytes), (ptr) =>
        image.mime === "image/png"
          ? api.EPDFImageObj_SetPng(page, 0, object, ptr, image.bytes.length)
          : api.EPDFImageObj_SetJpeg(page, 0, object, ptr, image.bytes.length),
      );
      if (!ok)
        throw new Error(
          "The picture could not be read. Use a PNG or JPEG file.",
        );
      check(
        api.FPDFPageObj_SetFillColor(object, 0, 0, 0, alpha),
        "set the picture's opacity",
      );
    },
    [box.width, 0, 0, box.height, 0, 0],
    "an image",
  );
}
