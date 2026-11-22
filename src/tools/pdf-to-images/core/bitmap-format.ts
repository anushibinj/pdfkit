/**
 * Convert PDFium bitmaps to RGBA. Pure.
 *
 * `FPDFImageObj_GetBitmap` and `FPDFImageObj_GetRenderedBitmap` return
 * bitmaps in PDFium's native layouts (fpdfview.h, `FPDFBitmap_*`), with
 * channels in B, G, R order and rows that may be padded to `stride` bytes.
 * The PNG encoder needs plain RGBA rows, so every format is converted here.
 */

/** `FPDFBitmap_GetFormat` values (fpdfview.h). */
export const BITMAP_FORMAT = {
  UNKNOWN: 0,
  /** One byte per pixel, gray. */
  GRAY: 1,
  /** Three bytes per pixel: B, G, R. */
  BGR: 2,
  /** Four bytes per pixel: B, G, R and an unused byte. */
  BGRX: 3,
  /** Four bytes per pixel: B, G, R, A (straight alpha). */
  BGRA: 4,
  /** Four bytes per pixel: B, G, R, A with colours multiplied by alpha. */
  BGRA_PREMUL: 5,
} as const;

/** A bitmap as copied out of PDFium's memory. */
export interface PdfiumBitmap {
  width: number;
  height: number;
  /** Bytes per row, at least width * bytes per pixel. */
  stride: number;
  /** One of {@link BITMAP_FORMAT}. */
  format: number;
  /** stride * height bytes. */
  data: Uint8Array;
}

/**
 * Bytes per pixel of a bitmap format.
 *
 * @param format A {@link BITMAP_FORMAT} value.
 * @returns 1, 3 or 4.
 * @throws {Error} For an unknown format.
 */
export function bytesPerPixelOf(format: number): number {
  switch (format) {
    case BITMAP_FORMAT.GRAY:
      return 1;
    case BITMAP_FORMAT.BGR:
      return 3;
    case BITMAP_FORMAT.BGRX:
    case BITMAP_FORMAT.BGRA:
    case BITMAP_FORMAT.BGRA_PREMUL:
      return 4;
    default:
      throw new Error(`Unsupported bitmap format ${format}`);
  }
}

/**
 * Undo alpha premultiplication of one colour sample.
 *
 * A premultiplied sample stores `colour * alpha / 255`; dividing back gives
 * the colour, rounded and capped at 255 (rounding in the encoder can push
 * the quotient slightly over). A fully transparent pixel has no colour to
 * recover, so it becomes 0.
 *
 * @param value The premultiplied sample.
 * @param alpha The pixel's alpha.
 * @returns The straight sample.
 */
export function unpremultiply(value: number, alpha: number): number {
  if (alpha === 0) return 0;
  return Math.min(255, Math.round((value * 255) / alpha));
}

/**
 * Convert a PDFium bitmap to RGBA with straight alpha, rows top to bottom
 * and no padding.
 *
 * For each row, start at `y * stride` (skipping any padding) and, per
 * pixel, swap B and R into R, G, B order; gray is copied into all three
 * channels. Formats without alpha get alpha 255 (BGRx's fourth byte is
 * undefined, so it is ignored, not copied).
 *
 * @param bitmap The bitmap.
 * @returns width * height * 4 bytes.
 * @throws {Error} For an unknown format or a buffer that is too short.
 */
export function bitmapToRgba(bitmap: PdfiumBitmap): Uint8Array {
  const { width, height, stride, format, data } = bitmap;
  const bpp = bytesPerPixelOf(format);
  if (
    stride < width * bpp ||
    data.length < stride * (height - 1) + width * bpp
  ) {
    throw new Error("Bitmap buffer is smaller than its size says");
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    let i = y * stride;
    let o = y * width * 4;
    for (let x = 0; x < width; x++, i += bpp, o += 4) {
      if (format === BITMAP_FORMAT.GRAY) {
        out[o] = out[o + 1] = out[o + 2] = data[i];
        out[o + 3] = 255;
        continue;
      }
      const b = data[i];
      const g = data[i + 1];
      const r = data[i + 2];
      if (format === BITMAP_FORMAT.BGRA_PREMUL) {
        const a = data[i + 3];
        out[o] = unpremultiply(r, a);
        out[o + 1] = unpremultiply(g, a);
        out[o + 2] = unpremultiply(b, a);
        out[o + 3] = a;
        continue;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = format === BITMAP_FORMAT.BGRA ? data[i + 3] : 255;
    }
  }
  return out;
}
