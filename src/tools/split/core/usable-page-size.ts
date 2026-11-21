import type { PageSize } from "../messages";

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
 * @returns The size, or a copy of {@link FALLBACK_PAGE_SIZE}.
 */
export function usablePageSize(width: number, height: number): PageSize {
  const valid =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  return valid ? { width, height } : { ...FALLBACK_PAGE_SIZE };
}
