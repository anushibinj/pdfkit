import type { PageSize } from "../messages";

/** Widest thumbnail bitmap, in pixels (a large grid cell on a 3x screen). */
export const MAX_THUMBNAIL_WIDTH = 1024;
/** Most pixels in one thumbnail (16 MB of RGBA), for very tall pages. */
export const MAX_THUMBNAIL_PIXELS = 4_000_000;
/** Used when a file reports a size that cannot be drawn: US Letter. */
export const FALLBACK_PAGE_SIZE: PageSize = { width: 612, height: 792 };

/**
 * A page size the layout can rely on.
 *
 * A damaged file can report a zero, negative or NaN width or height (an
 * empty or inverted MediaBox). Dividing by that would make the aspect ratio
 * infinite or NaN, so such a page is laid out as US Letter instead; PDFium
 * still draws whatever it can into that box.
 *
 * @param width Reported width in points.
 * @param height Reported height in points.
 * @returns The size, or {@link FALLBACK_PAGE_SIZE}.
 */
export function usablePageSize(width: number, height: number): PageSize {
  const valid =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  return valid ? { width, height } : { ...FALLBACK_PAGE_SIZE };
}

/**
 * Bitmap size for drawing a page `requestedWidth` pixels wide.
 *
 * The height follows the page's shape. The width is clamped to
 * 1..{@link MAX_THUMBNAIL_WIDTH} (the request comes from another thread
 * and could be anything), and if a very tall page would still need more
 * than {@link MAX_THUMBNAIL_PIXELS}, both sides shrink by the same factor,
 * the square root of the excess, because area grows with the square of
 * the side, so the shape is kept.
 *
 * @param page The page's shown size, in points (positive).
 * @param requestedWidth Desired width in pixels.
 * @returns Whole-pixel width and height, each at least 1.
 */
export function thumbnailSize(page: PageSize, requestedWidth: number): PageSize {
  let width = Math.min(
    MAX_THUMBNAIL_WIDTH,
    Math.max(1, Math.round(requestedWidth) || 1),
  );
  let height = Math.max(1, Math.round((width * page.height) / page.width));
  if (width * height > MAX_THUMBNAIL_PIXELS) {
    const shrink = Math.sqrt(MAX_THUMBNAIL_PIXELS / (width * height));
    width = Math.max(1, Math.floor(width * shrink));
    height = Math.max(1, Math.floor(height * shrink));
  }
  return { width, height };
}
