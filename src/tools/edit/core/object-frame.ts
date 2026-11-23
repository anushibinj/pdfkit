import { applyToPoint, compose, invert, type Matrix } from "@/lib/affine";
import type { ObjectFrame, PageBox, Point, QuarterTurns } from "./model";
import { userToView, viewToUser } from "./page-geometry";

/**
 * Where an object's local axes point in user space, per rotation.
 *
 * Local space reads like a page: `u` to the right, `v` downwards. User space
 * has y pointing up, so for an unrotated object "down" is (0, -1). Each
 * counter-clockwise quarter turn rotates both axes by 90 degrees:
 * (x, y) -> (-y, x). Applying that to right = (1, 0) and down = (0, -1)
 * repeatedly gives the table.
 */
const AXES: Record<QuarterTurns, { right: Point; down: Point }> = {
  0: { right: { x: 1, y: 0 }, down: { x: 0, y: -1 } },
  1: { right: { x: 0, y: 1 }, down: { x: 1, y: 0 } },
  2: { right: { x: -1, y: 0 }, down: { x: 0, y: 1 } },
  3: { right: { x: 0, y: -1 }, down: { x: -1, y: 0 } },
};

/**
 * Transform from an object's local space to PDF user space.
 *
 * A local point (u, v) lands at origin + u * right + v * down, which in
 * matrix form puts `right` in the first column (a, b), `down` in the second
 * column (c, d) and the origin in the translation (e, f).
 *
 * @param frame The object's position and rotation.
 * @returns The local-to-user transform.
 */
export function objectToUser(
  frame: Pick<ObjectFrame, "x" | "y" | "rotation">,
): Matrix {
  const { right, down } = AXES[frame.rotation];
  return [right.x, right.y, down.x, down.y, frame.x, frame.y];
}

/**
 * Transform from an object's local space to the page's view space (points
 * from the displayed page's top-left corner, y down).
 *
 * @param frame The object's position and rotation.
 * @param box The page's visible area in user space.
 * @param turns Clockwise display rotation of the page.
 * @returns The local-to-view transform; feed it to SVG to draw the object.
 */
export function objectToView(
  frame: Pick<ObjectFrame, "x" | "y" | "rotation">,
  box: PageBox,
  turns: QuarterTurns,
): Matrix {
  return compose(userToView(box, turns), objectToUser(frame));
}

/**
 * The inverse of {@link objectToView}: turn a pointer position on the page
 * into the object's local coordinates (used while drawing and resizing).
 *
 * @param frame The object's position and rotation.
 * @param box The page's visible area in user space.
 * @param turns Clockwise display rotation of the page.
 * @returns The view-to-local transform.
 */
export function viewToObject(
  frame: Pick<ObjectFrame, "x" | "y" | "rotation">,
  box: PageBox,
  turns: QuarterTurns,
): Matrix {
  return invert(objectToView(frame, box, turns));
}

/**
 * Frame for a new object whose top-left corner is at a point the user
 * clicked, facing upright on screen.
 *
 * Why `rotation = turns`: a page shown turned clockwise by k quarter turns
 * displays everything on it turned clockwise by k as well. Turning the object
 * counter-clockwise by the same k (in user space) cancels that out, so the
 * object reads upright on screen. The unit tests check that the combined
 * local-to-view transform is then a pure translation.
 *
 * @param viewPoint Where the user clicked, in view space.
 * @param box The page's visible area in user space.
 * @param turns Clockwise display rotation of the page.
 * @returns Position and rotation for the new object.
 */
export function uprightFrameAt(
  viewPoint: Point,
  box: PageBox,
  turns: QuarterTurns,
): Pick<ObjectFrame, "x" | "y" | "rotation"> {
  const user = applyToPoint(viewToUser(box, turns), viewPoint);
  return { x: user.x, y: user.y, rotation: turns };
}
