import type { Size } from "../geometry/page-geometry";

/** Widest page bitmap the worker renders, in pixels. */
export const MAX_RENDER_WIDTH = 4096;
/** Most pixels in one page bitmap (64 MB of RGBA). */
export const MAX_RENDER_PIXELS = 16_000_000;

/**
 * Pixel size for rendering a page at a requested width.
 *
 * The height follows the displayed page's aspect ratio. The width is
 * clamped to 1..{@link MAX_RENDER_WIDTH}, and if a very tall page would
 * still exceed {@link MAX_RENDER_PIXELS}, both sides shrink by the same
 * factor (the square root of the excess, since area scales with the square
 * of the side) so the shape is kept.
 *
 * @param view The displayed page size in points.
 * @param requestedWidth Desired bitmap width in pixels.
 * @returns Whole-pixel width and height, each at least 1.
 */
export function fitRenderSize(view: Size, requestedWidth: number): Size {
  const width = Math.min(
    MAX_RENDER_WIDTH,
    Math.max(1, Math.round(requestedWidth) || 1),
  );
  const aspect = view.width > 0 ? view.height / view.width : 1;
  let w = width;
  let h = Math.max(1, Math.round(width * aspect));
  if (w * h > MAX_RENDER_PIXELS) {
    const shrink = Math.sqrt(MAX_RENDER_PIXELS / (w * h));
    w = Math.max(1, Math.floor(w * shrink));
    h = Math.max(1, Math.floor(h * shrink));
  }
  return { width: w, height: h };
}
