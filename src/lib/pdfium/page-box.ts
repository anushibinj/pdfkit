/**
 * Page geometry shared by every tool that opens PDFs with PDFium: plain,
 * JSON-serialisable types (so a page's size can cross the worker boundary
 * as-is) and small pure helpers for them.
 */

/** A number of 90 degree turns. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * The page's visible area in user space (PDFium's page bounding box: the
 * CropBox clipped to the MediaBox). It does not have to start at (0, 0).
 */
export interface PageBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** A width and a height, in points unless stated otherwise. */
export interface Size {
  width: number;
  height: number;
}

/** What a worker reports about one page of an opened file. */
export interface PageInfo {
  box: PageBox;
  /** The page's own /Rotate, as clockwise quarter turns. */
  rotation: QuarterTurns;
}

/**
 * Type guard for quarter-turn counts coming from untyped input.
 *
 * @param value Anything.
 * @returns `true` for the integers 0, 1, 2 and 3.
 */
export function isQuarterTurns(value: unknown): value is QuarterTurns {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/**
 * The size of a page box before any rotation.
 *
 * @param box The page's visible area in user space.
 * @returns Its width and height in points.
 */
export function boxSize(box: PageBox): Size {
  return { width: box.right - box.left, height: box.top - box.bottom };
}

/**
 * The size of a page as it is displayed after rotating it.
 *
 * An odd number of quarter turns lays the page on its side, which swaps
 * width and height.
 *
 * @param box The page's visible area in user space.
 * @param turns Clockwise display rotation (page /Rotate plus user turns).
 * @returns The displayed width and height in points.
 */
export function viewSize(box: PageBox, turns: QuarterTurns): Size {
  const { width, height } = boxSize(box);
  return turns % 2 === 0 ? { width, height } : { width: height, height: width };
}

/**
 * Add two rotations and wrap the result into 0..3.
 *
 * `((n % 4) + 4) % 4` instead of `n % 4` because JavaScript's `%` keeps the
 * sign of the left operand: -1 % 4 is -1, but a quarter turn to the left
 * must come out as 3 quarter turns to the right.
 *
 * @param a A rotation in quarter turns (may be negative).
 * @param b Another rotation in quarter turns (may be negative).
 * @returns The combined rotation, 0..3.
 */
export function addTurns(a: number, b: number): QuarterTurns {
  return ((((a + b) % 4) + 4) % 4) as QuarterTurns;
}
