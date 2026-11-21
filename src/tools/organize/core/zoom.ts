/**
 * Thumbnail zoom levels for the page board.
 *
 * Each level is the smallest width a page column may have; the grid fits as
 * many such columns as the screen allows (`auto-fill`). The class names are
 * written out in full so Tailwind generates them. Even the largest level
 * fits one column on a 360 px phone (360 - 2 x 16 px gutters = 328 px), so
 * zooming in never causes horizontal scrolling.
 */
export const ZOOM_LEVELS = [
  {
    label: "Small",
    columns: "grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]",
  },
  {
    label: "Medium",
    columns: "grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]",
  },
  {
    label: "Large",
    columns: "grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]",
  },
  {
    label: "Extra large",
    columns: "grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]",
  },
] as const;

/** The level the board starts at. */
export const DEFAULT_ZOOM = 1;

/**
 * Bitmap widths for thumbnails (see `renderWidthFor`): small steps, so a
 * thumbnail is never rendered much wider than it is shown, and a cap well
 * below full-page size, so a 500-page board stays light on memory.
 */
export const THUMBNAIL_RENDER_LIMITS = {
  step: 64,
  min: 128,
  max: 768,
} as const;

/**
 * Change the zoom level by `delta` steps, staying within the levels.
 *
 * @param level The current level index.
 * @param delta +1 to zoom in, -1 to zoom out.
 * @returns The new level index.
 */
export function stepZoom(level: number, delta: number): number {
  const next = Math.trunc(level + delta) || 0;
  return Math.min(ZOOM_LEVELS.length - 1, Math.max(0, next));
}
