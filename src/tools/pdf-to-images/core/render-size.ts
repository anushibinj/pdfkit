import type { Size } from "@/lib/pdfium/page";

/** PDF user space has 72 units (points) per inch. */
export const POINTS_PER_INCH = 72;
/**
 * Largest width or height of a page image. Browsers refuse bigger canvases
 * (the JPEG encoder draws onto one), and 16,384 is within every engine's
 * per-side limit.
 */
export const MAX_IMAGE_SIDE = 16_384;
/**
 * Most pixels in one page image: 4096 x 4096. That is the canvas area
 * Safari on iOS allows, and it keeps one page's working memory (RGBA in the
 * engine, a copy for encoding) around 130 MB, which phones can afford. An
 * A4 page fits at 300 DPI (about 8.7 million pixels).
 */
export const MAX_IMAGE_PIXELS = 4096 * 4096;

/** The bitmap size chosen for a page, and the resolution it really has. */
export interface PageImageSize {
  width: number;
  height: number;
  /** The resolution achieved, below the requested one when `reduced`. */
  dpi: number;
  /** The requested resolution had to be lowered to stay within the limits. */
  reduced: boolean;
}

/**
 * Pixel size of a page rendered at `dpi`.
 *
 * Step by step:
 * 1. A page `w` points wide is `w / 72` inches, so at `dpi` dots per inch
 *    it is `w * dpi / 72` pixels; the same for the height.
 * 2. If that exceeds a limit, one scale factor shrinks both sides so the
 *    page keeps its shape: `MAX_IMAGE_SIDE / longest side` for the side
 *    limit, and the square root of `MAX_IMAGE_PIXELS / area` for the area
 *    limit (area grows with the square of the scale). The smaller factor
 *    wins.
 * 3. Sizes are rounded to whole pixels, at least 1. When the size was
 *    reduced they are rounded down, so rounding can never push the result
 *    back over the limit.
 *
 * @param page The page size in points, as displayed (after rotation).
 * @param dpi The requested resolution.
 * @returns Whole-pixel width and height and the effective resolution.
 */
export function pageImageSize(page: Size, dpi: number): PageImageSize {
  const exactWidth = Math.max(0, (page.width * dpi) / POINTS_PER_INCH);
  const exactHeight = Math.max(0, (page.height * dpi) / POINTS_PER_INCH);
  const longest = Math.max(exactWidth, exactHeight);
  const area = exactWidth * exactHeight;
  const factor = Math.min(
    1,
    longest > 0 ? MAX_IMAGE_SIDE / longest : 1,
    area > 0 ? Math.sqrt(MAX_IMAGE_PIXELS / area) : 1,
  );
  const reduced = factor < 1;
  const round = reduced ? Math.floor : Math.round;
  return {
    width: Math.max(1, round(exactWidth * factor)),
    height: Math.max(1, round(exactHeight * factor)),
    dpi: reduced ? Math.floor(dpi * factor) : dpi,
    reduced,
  };
}
