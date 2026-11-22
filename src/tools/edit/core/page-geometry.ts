import { compose, invert, type Matrix } from "@/lib/affine";
import {
  boxSize,
  type PageBox,
  type QuarterTurns,
} from "@/lib/pdfium/page-box";

// Shared with other tools; re-exported for the editor's existing imports.
export { addTurns } from "@/lib/pdfium/page-box";

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
