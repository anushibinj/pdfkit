import { applyToPoint } from "@/lib/geometry/affine";
import {
  viewSize,
  viewToUser,
  type PageBox,
  type QuarterTurns,
  type Size,
} from "@/lib/geometry/page-geometry";

/**
 * How much to cut from each edge of a page, in points, measured on the page
 * **as it is displayed** (after its /Rotate): `top` is always the edge the
 * reader sees at the top. Margins rather than a rectangle, because one set
 * of margins means the same thing on pages of different sizes ("cut 1 cm
 * off every side"), which is what cropping many pages at once needs.
 */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A rectangle on the displayed page: points from its top-left, y down. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle in PDF user space (points, y up), as the crop library takes it. */
export interface UserRect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** No margins: the whole page. */
export const NO_MARGINS: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

/** The smallest crop area accepted on either side, in points (about 3.5 mm). */
export const MIN_CROP_SIZE = 10;

/** Points per millimetre (a point is 1/72 inch, an inch 25.4 mm). */
export const POINTS_PER_MM = 72 / 25.4;

/**
 * Millimetres to points.
 *
 * @param mm A length in millimetres.
 * @returns The same length in points.
 */
export function mmToPoints(mm: number): number {
  return mm * POINTS_PER_MM;
}

/**
 * Points to millimetres.
 *
 * @param points A length in points.
 * @returns The same length in millimetres.
 */
export function pointsToMm(points: number): number {
  return points / POINTS_PER_MM;
}

/**
 * The area left inside the margins of a displayed page.
 *
 * @param view The displayed page size in points.
 * @param margins What to cut from each edge.
 * @returns The rectangle, or `null` when the margins are not finite, are
 *   negative, or leave less than {@link MIN_CROP_SIZE} on either side.
 */
export function cropRectInView(view: Size, margins: Margins): ViewRect | null {
  const { top, right, bottom, left } = margins;
  if (![top, right, bottom, left].every((m) => Number.isFinite(m) && m >= 0))
    return null;
  const width = view.width - left - right;
  const height = view.height - top - bottom;
  if (width < MIN_CROP_SIZE || height < MIN_CROP_SIZE) return null;
  return { x: left, y: top, width, height };
}

/**
 * The margins that leave exactly `rect` on a displayed page (the inverse of
 * {@link cropRectInView}).
 *
 * @param view The displayed page size in points.
 * @param rect The area to keep, in view coordinates.
 * @returns The margins.
 */
export function marginsFromViewRect(view: Size, rect: ViewRect): Margins {
  return {
    top: rect.y,
    left: rect.x,
    right: view.width - rect.x - rect.width,
    bottom: view.height - rect.y - rect.height,
  };
}

/**
 * Convert an area of the displayed page to PDF user space.
 *
 * The displayed page may be rotated, and its box may not start at (0, 0),
 * so two opposite corners are mapped through the view-to-user transform
 * (`viewToUser`, the inverse of the one the PDF Editor draws with) and the
 * result normalised, since a rotation can swap which corner is lower-left.
 *
 * @param rect The area in view coordinates.
 * @param box The page's visible box in user space.
 * @param rotation The page's /Rotate in quarter turns.
 * @returns The same area in user space.
 */
export function viewRectToUser(
  rect: ViewRect,
  box: PageBox,
  rotation: QuarterTurns,
): UserRect {
  const m = viewToUser(box, rotation);
  const a = applyToPoint(m, { x: rect.x, y: rect.y });
  const b = applyToPoint(m, {
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  });
  return {
    left: Math.min(a.x, b.x),
    bottom: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    top: Math.max(a.y, b.y),
  };
}

/**
 * The user-space crop rectangle of a page for the given margins.
 *
 * @param box The page's visible box in user space.
 * @param rotation The page's /Rotate in quarter turns.
 * @param margins What to cut from each displayed edge.
 * @returns The rectangle, or `null` when the margins leave too little.
 */
export function cropRectForPage(
  box: PageBox,
  rotation: QuarterTurns,
  margins: Margins,
): UserRect | null {
  const rect = cropRectInView(viewSize(box, rotation), margins);
  return rect && viewRectToUser(rect, box, rotation);
}
