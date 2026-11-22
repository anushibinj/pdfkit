import { compose, type Matrix, type Point } from "@/lib/affine";
import type { Size } from "@/lib/pdfium/page-box";
import type { Anchor, Position } from "./model";

/**
 * Where each anchor sits, as fractions of the free space along each axis:
 * `x` from the left edge, `y` from the bottom edge (the stamp page has y
 * pointing up, so "top" is y = 1).
 */
const ANCHOR_FRACTIONS: Record<Anchor, { x: number; y: number }> = {
  "top-left": { x: 0, y: 1 },
  top: { x: 0.5, y: 1 },
  "top-right": { x: 1, y: 1 },
  left: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  right: { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 0 },
  bottom: { x: 0.5, y: 0 },
  "bottom-right": { x: 1, y: 0 },
};

/** Largest distance kept between an anchored watermark and the page edge (half an inch). */
export const MAX_MARGIN = 36;

/**
 * Margin as a fraction of the page's shorter side, for small pages. A
 * sixteenth gives at least {@link MAX_MARGIN} on Letter (612 pt) and A4
 * (595 pt), so those get the full half inch.
 */
export const MARGIN_RATIO = 1 / 16;

/** Smallest gap between tiled copies, in points. */
export const MIN_TILE_GAP = 24;

/** Gap between tiled copies, as a fraction of the copy's longer side. */
export const TILE_GAP_RATIO = 0.5;

/**
 * Most copies a tiled page may get. Each copy is a few content-stream
 * operators (and every copy of a picture reuses one image), so this keeps
 * the file and the drawing time small even for a tiny watermark on a huge
 * page.
 */
export const MAX_TILES = 400;

/**
 * Distance kept between an anchored watermark and the page edges.
 *
 * Half an inch on Letter, A4 and larger pages; a sixteenth of the shorter
 * side on smaller ones, so a corner watermark on a business card is not
 * pushed towards the middle.
 *
 * @param page The displayed page size.
 * @returns The margin in points.
 */
export function pageMargin(page: Size): number {
  return Math.min(MAX_MARGIN, MARGIN_RATIO * Math.min(page.width, page.height));
}

/**
 * The rotation by `degrees`, counter-clockwise, about the origin.
 *
 * In PDF order [a, b, c, d, e, f] a point maps to (a*x + c*y, b*x + d*y);
 * a counter-clockwise turn by t is x' = x cos t - y sin t,
 * y' = x sin t + y cos t, hence [cos, sin, -sin, cos, 0, 0]. In a space with
 * y pointing up (the stamp page), counter-clockwise is what the reader sees.
 *
 * @param degrees The angle.
 * @returns The rotation matrix.
 */
export function rotationMatrix(degrees: number): Matrix {
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [cos, sin, -sin, cos, 0, 0];
}

/**
 * Size of the axis-aligned box around a rotated rectangle.
 *
 * Rotating a w x h rectangle by t sends its half-diagonals (±w/2, ±h/2) to
 * points whose largest x is (w|cos t| + h|sin t|) / 2 and largest y is
 * (w|sin t| + h|cos t|) / 2. Doubling gives the box. At 0° it is w x h, at
 * 90° h x w, at 45° a square of side (w + h) / √2.
 *
 * @param size The rectangle before rotating.
 * @param degrees The rotation.
 * @returns The width and height of its bounding box.
 */
export function rotatedBounds(size: Size, degrees: number): Size {
  const t = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(t));
  const sin = Math.abs(Math.sin(t));
  return {
    width: size.width * cos + size.height * sin,
    height: size.width * sin + size.height * cos,
  };
}

/**
 * The transform that draws one copy of the content, rotated, centred on a
 * point.
 *
 * The content's own space has its box from (0, 0) to (width, height).
 * Reading the composition right to left:
 * 1. move the box's centre to the origin: translate(-w/2, -h/2);
 * 2. rotate about that centre;
 * 3. move the centre to `center`.
 * Rotating about the centre (not a corner) is what keeps the copy where
 * the layout put it, whatever the angle.
 *
 * @param center Where the copy's centre goes, in page space.
 * @param content The content's unrotated size.
 * @param degrees Counter-clockwise rotation.
 * @returns Content space to page space.
 */
export function placeAt(center: Point, content: Size, degrees: number): Matrix {
  return compose(
    [1, 0, 0, 1, center.x, center.y],
    compose(rotationMatrix(degrees), [
      1,
      0,
      0,
      1,
      -content.width / 2,
      -content.height / 2,
    ]),
  );
}

/**
 * Centre of a single anchored copy.
 *
 * Per axis, the copy's (rotated) box of size `b` may move between the two
 * margins, a free space of `page - 2*margin - b`. The anchor fraction `f`
 * (0, 0.5 or 1) picks a point in it: centre = margin + b/2 + f * free.
 * That gives margin + b/2 at the start edge, page/2 in the middle and
 * page - margin - b/2 at the far edge.
 *
 * When the box does not fit between the margins (free < 0), it is centred
 * on that axis instead, so an oversized watermark overflows both edges
 * equally rather than only the far one.
 *
 * @param page The displayed page size.
 * @param bounds The rotated box of the copy (see {@link rotatedBounds}).
 * @param anchor Which of the nine positions.
 * @param margin Distance from the edges.
 * @returns The centre in page space (y up).
 */
export function anchorCenter(
  page: Size,
  bounds: Size,
  anchor: Anchor,
  margin: number,
): Point {
  const f = ANCHOR_FRACTIONS[anchor];
  const axis = (length: number, extent: number, fraction: number) => {
    const free = length - 2 * margin - extent;
    return free < 0 ? length / 2 : margin + extent / 2 + fraction * free;
  };
  return {
    x: axis(page.width, bounds.width, f.x),
    y: axis(page.height, bounds.height, f.y),
  };
}

/**
 * Centres of the copies that tile a page.
 *
 * The copies lie on a grid that is rotated with the watermark, so a
 * diagonal text repeats along its own direction, as tiled watermarks
 * usually do:
 * - `u` = (cos t, sin t) runs along the text, `v` = (-sin t, cos t) across
 *   it. Copies sit at C + (i * stepU + shift) * u + j * stepV * v, where C
 *   is the page centre (so the pattern is centred too).
 * - Steps are the content's size plus a gap of half its longer side (at
 *   least {@link MIN_TILE_GAP}), so copies never overlap.
 * - Every other row is shifted by half a step (`shift`), a brick pattern
 *   that avoids empty diagonal lanes.
 *
 * Which (i, j) to visit: a copy can only touch the page if its centre is
 * within R = (page diagonal + content diagonal) / 2 of the page centre,
 * because the page fits in a circle of half its diagonal around C and the
 * copy in a circle of half its own diagonal around its centre. So i runs
 * over ±(R / stepU + 1) (the +1 covers the half-step shift) and j over
 * ±R / stepV. Candidates whose rotated box misses the page are dropped.
 *
 * Bounding the count: the number of candidates is at most
 * (2*nu + 1) * (2*nv + 1). If that exceeds {@link MAX_TILES}, both steps
 * grow by the same factor sqrt(count / MAX_TILES); area per copy scales with
 * the square of that factor, so the count drops below the limit while the
 * pattern keeps its proportions. The loop repeats because rounding up can
 * leave it slightly above.
 *
 * @param page The displayed page size.
 * @param content The content's unrotated size.
 * @param degrees Counter-clockwise rotation.
 * @returns The centres, row by row (deterministic order).
 */
export function tileCenters(
  page: Size,
  content: Size,
  degrees: number,
): Point[] {
  const t = (degrees * Math.PI) / 180;
  const u = { x: Math.cos(t), y: Math.sin(t) };
  const v = { x: -Math.sin(t), y: Math.cos(t) };
  const gap = Math.max(
    MIN_TILE_GAP,
    TILE_GAP_RATIO * Math.max(content.width, content.height),
  );
  let stepU = content.width + gap;
  let stepV = content.height + gap;
  const reach =
    (Math.hypot(page.width, page.height) +
      Math.hypot(content.width, content.height)) /
    2;
  let nu = Math.ceil(reach / stepU) + 1;
  let nv = Math.ceil(reach / stepV);
  while ((2 * nu + 1) * (2 * nv + 1) > MAX_TILES) {
    const grow = Math.sqrt(((2 * nu + 1) * (2 * nv + 1)) / MAX_TILES);
    stepU *= grow;
    stepV *= grow;
    nu = Math.ceil(reach / stepU) + 1;
    nv = Math.ceil(reach / stepV);
  }

  const bounds = rotatedBounds(content, degrees);
  const centre = { x: page.width / 2, y: page.height / 2 };
  const centres: Point[] = [];
  for (let j = -nv; j <= nv; j++) {
    // `Math.abs`: in JavaScript -1 % 2 is -1, not 1.
    const shift = Math.abs(j) % 2 === 1 ? stepU / 2 : 0;
    for (let i = -nu; i <= nu; i++) {
      const along = i * stepU + shift;
      const across = j * stepV;
      const p = {
        x: centre.x + along * u.x + across * v.x,
        y: centre.y + along * u.y + across * v.y,
      };
      // Keep the copy if its rotated box overlaps the page (strictly: a
      // copy that only touches an edge would draw nothing visible).
      const overlapsX =
        Math.abs(p.x - centre.x) < (page.width + bounds.width) / 2;
      const overlapsY =
        Math.abs(p.y - centre.y) < (page.height + bounds.height) / 2;
      if (overlapsX && overlapsY) centres.push(p);
    }
  }
  return centres;
}

/**
 * Lay out a watermark on one page.
 *
 * @param page The displayed page size.
 * @param content The content's unrotated size (from the painter).
 * @param degrees Counter-clockwise rotation.
 * @param position An anchor, or "tile".
 * @returns One content-to-page transform per copy (none when the content
 *   has no area, since it would draw nothing).
 */
export function layoutWatermark(
  page: Size,
  content: Size,
  degrees: number,
  position: Position,
): Matrix[] {
  if (!(content.width > 0 && content.height > 0)) return [];
  if (position === "tile") {
    return tileCenters(page, content, degrees).map((c) =>
      placeAt(c, content, degrees),
    );
  }
  const centre = anchorCenter(
    page,
    rotatedBounds(content, degrees),
    position,
    pageMargin(page),
  );
  return [placeAt(centre, content, degrees)];
}
