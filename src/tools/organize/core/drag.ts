/**
 * Pure geometry for dragging pages on the board. The DOM side (pointer
 * events, hit testing, scrolling) lives in `use-board-drag.ts`; everything
 * that can be computed from numbers lives here, so it can be tested.
 */

/** How far (CSS pixels) a pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 6;

/** Height of the band at the top and bottom of the screen that scrolls. */
export const AUTO_SCROLL_EDGE = 72;

/** Fastest auto-scroll, in CSS pixels per animation frame. */
export const AUTO_SCROLL_MAX = 24;

/**
 * Whether a press has moved far enough to count as a drag. Below the
 * threshold it is still a click, so a slightly shaky click does not move a
 * page.
 *
 * @param dx Horizontal distance from the press, in CSS pixels.
 * @param dy Vertical distance from the press, in CSS pixels.
 * @returns `true` once the pointer is {@link DRAG_THRESHOLD} or more away.
 */
export function passedThreshold(dx: number, dy: number): boolean {
  return dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD;
}

/**
 * The gap a drop over a page card means.
 *
 * Pages read left to right, so the left half of card `index` means "before
 * it" (gap `index`) and the right half means "after it" (gap `index + 1`).
 *
 * @param index The card's position on the board.
 * @param rect The card's left edge and width on screen.
 * @param x The pointer's x on screen.
 * @returns The gap, `index` or `index + 1`.
 */
export function gapAtPointer(
  index: number,
  rect: { left: number; width: number },
  x: number,
): number {
  return x < rect.left + rect.width / 2 ? index : index + 1;
}

/**
 * Auto-scroll speed for a pointer at `y` while dragging, so a page can be
 * dragged to a part of the board that is off screen.
 *
 * Inside the top band the page scrolls up, inside the bottom band down, and
 * the closer to the edge the faster (linear from 0 at the band's inner edge
 * to {@link AUTO_SCROLL_MAX} at the screen edge). Elsewhere it stays still.
 *
 * @param y Pointer y within the viewport, in CSS pixels.
 * @param viewportHeight The viewport's height.
 * @returns Pixels to scroll this frame: negative up, positive down.
 */
export function autoScrollSpeed(y: number, viewportHeight: number): number {
  const edge = Math.min(AUTO_SCROLL_EDGE, viewportHeight / 4);
  if (edge <= 0) return 0;
  if (y < edge) {
    const depth = (edge - Math.max(0, y)) / edge;
    return -Math.ceil(depth * AUTO_SCROLL_MAX);
  }
  if (y > viewportHeight - edge) {
    const depth = (y - (viewportHeight - edge)) / edge;
    return Math.ceil(Math.min(1, depth) * AUTO_SCROLL_MAX);
  }
  return 0;
}

/**
 * Number of columns in a wrapped grid, from its items' top offsets: the
 * items on the first row share the first item's top.
 *
 * Measuring beats re-deriving the CSS: the grid uses `auto-fill`, so the
 * column count depends on the width, the zoom level and the gap.
 *
 * @param tops Each item's top offset, in order.
 * @returns Items per row (1 for an empty grid).
 */
export function columnCount(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  let count = 0;
  // Sub-pixel layout can put items of one row a fraction apart.
  while (count < tops.length && Math.abs(tops[count] - tops[0]) < 1) count++;
  return Math.max(1, count);
}
