import { compose, invert, type Matrix } from "./affine";
import type { PageBox, QuarterTurns } from "./model";

/** A width and a height, in points unless stated otherwise. */
export interface Size {
  width: number;
  height: number;
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
 * Transform from PDF user space to "view space": the page as displayed,
 * measured in points from its top-left corner, with y growing downwards
 * (screen and SVG convention).
 *
 * How it is built, step by step:
 * 1. Unrotated view. User space has its origin at the bottom-left and y
 *    pointing up, and the box may start anywhere (for example at
 *    (100, 50)). Moving the origin to the box's top-left corner and flipping
 *    y gives view = (x - left, top - y), i.e. the matrix
 *    [1, 0, 0, -1, -left, top].
 * 2. Each clockwise quarter turn of a displayed page of size w x h moves a
 *    view point (p, q) to (h - q, p): the old left edge (p = 0) becomes the
 *    new top edge, and the old bottom edge (q = h) becomes the new left edge.
 *    As a matrix that is [0, 1, -1, 0, h, 0]. After the turn the page is
 *    h x w, so the next turn uses the swapped size.
 * PDF readers (and PDFium) rotate pages clockwise for a positive /Rotate,
 * which the integration tests check against real PDFium rendering.
 *
 * @param box The page's visible area in user space.
 * @param turns Clockwise display rotation (page /Rotate plus user turns).
 * @returns The user-space to view-space transform.
 */
export function userToView(box: PageBox, turns: QuarterTurns): Matrix {
  let m: Matrix = [1, 0, 0, -1, -box.left, box.top];
  let { width, height } = boxSize(box);
  for (let i = 0; i < turns; i++) {
    m = compose([0, 1, -1, 0, height, 0], m);
    [width, height] = [height, width];
  }
  return m;
}

/**
 * The inverse of {@link userToView}: from a point on the displayed page back
 * to PDF user space (used for pointer positions).
 *
 * @param box The page's visible area in user space.
 * @param turns Clockwise display rotation.
 * @returns The view-space to user-space transform.
 */
export function viewToUser(box: PageBox, turns: QuarterTurns): Matrix {
  return invert(userToView(box, turns));
}
