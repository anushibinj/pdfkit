/** Bitmap widths are rounded up to a multiple of this many pixels. */
export const RENDER_WIDTH_STEP = 256;
/** Widest bitmap the page view asks for (sharp on a 4K screen, not wasteful). */
export const MAX_VIEW_RENDER_WIDTH = 2560;
/** Narrowest bitmap the page view asks for. */
export const MIN_VIEW_RENDER_WIDTH = 512;

/**
 * Pick the bitmap width to request for a page shown `cssWidth` CSS pixels
 * wide on a screen with `devicePixelRatio`.
 *
 * Matching device pixels keeps text sharp on high-density screens. The
 * result is rounded up to {@link RENDER_WIDTH_STEP} so that small layout
 * changes (a scrollbar appearing, a window resized by a few pixels) do not
 * re-render every page, and clamped so tiny or enormous layouts stay sane.
 *
 * @param cssWidth The page's on-screen width in CSS pixels (0 if unknown).
 * @param devicePixelRatio Device pixels per CSS pixel (NaN/0 counts as 1).
 * @returns The bitmap width in device pixels.
 */
export function renderWidthFor(
  cssWidth: number,
  devicePixelRatio: number,
): number {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const wanted =
    Math.ceil((Math.max(0, cssWidth) * ratio) / RENDER_WIDTH_STEP) *
    RENDER_WIDTH_STEP;
  return Math.min(
    MAX_VIEW_RENDER_WIDTH,
    Math.max(MIN_VIEW_RENDER_WIDTH, wanted),
  );
}
