/** Bitmap widths are rounded up to a multiple of this many pixels. */
export const RENDER_WIDTH_STEP = 256;
/** Widest bitmap the page view asks for (sharp on a 4K screen, not wasteful). */
export const MAX_VIEW_RENDER_WIDTH = 2560;
/** Narrowest bitmap the page view asks for. */
export const MIN_VIEW_RENDER_WIDTH = 512;

/** Rounding step and bounds for {@link renderWidthFor}, in device pixels. */
export interface RenderWidthLimits {
  step: number;
  min: number;
  max: number;
}

/** The limits for full-size pages in the PDF editor. */
export const VIEW_RENDER_LIMITS: RenderWidthLimits = {
  step: RENDER_WIDTH_STEP,
  min: MIN_VIEW_RENDER_WIDTH,
  max: MAX_VIEW_RENDER_WIDTH,
};

/**
 * Pick the bitmap width to request for a page shown `cssWidth` CSS pixels
 * wide on a screen with `devicePixelRatio`.
 *
 * Matching device pixels keeps text sharp on high-density screens. The
 * result is rounded up to `limits.step` so that small layout changes (a
 * scrollbar appearing, a window resized by a few pixels) do not re-render
 * every page, and clamped so tiny or enormous layouts stay sane.
 *
 * @param cssWidth The page's on-screen width in CSS pixels (0 if unknown).
 * @param devicePixelRatio Device pixels per CSS pixel (NaN/0 counts as 1).
 * @param limits Rounding step and bounds; the editor's full-size page
 *   limits by default, smaller ones for thumbnails.
 * @returns The bitmap width in device pixels.
 */
export function renderWidthFor(
  cssWidth: number,
  devicePixelRatio: number,
  limits: RenderWidthLimits = VIEW_RENDER_LIMITS,
): number {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const wanted =
    Math.ceil((Math.max(0, cssWidth) * ratio) / limits.step) * limits.step;
  return Math.min(limits.max, Math.max(limits.min, wanted));
}
