import type { Point } from "./model";

/**
 * A 2D affine transform in PDF order `[a, b, c, d, e, f]`, mapping a point
 * `(x, y)` to `(a*x + c*y + e, b*x + d*y + f)`.
 *
 * This is the same layout as the PDF `cm` operator, PDFium's
 * `FPDFPageObj_Transform` and SVG's `matrix(a b c d e f)`, so one value can be
 * handed to all three without reshuffling.
 */
export type Matrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

/** The transform that changes nothing. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * Chain two transforms: the result applies `inner` first, then `outer`.
 *
 * Derivation. Write `inner` as x' = a1 x + c1 y + e1, y' = b1 x + d1 y + f1,
 * then substitute x' and y' into `outer`:
 *   x'' = a2 x' + c2 y' + e2
 *       = (a2 a1 + c2 b1) x + (a2 c1 + c2 d1) y + (a2 e1 + c2 f1 + e2)
 *   y'' = b2 x' + d2 y' + f2
 *       = (b2 a1 + d2 b1) x + (b2 c1 + d2 d1) y + (b2 e1 + d2 f1 + f2)
 * Reading off the coefficients gives the six values below.
 *
 * @param outer Applied second.
 * @param inner Applied first.
 * @returns `outer ∘ inner`.
 */
export function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a2, b2, c2, d2, e2, f2] = outer;
  const [a1, b1, c1, d1, e1, f1] = inner;
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
}

/**
 * Undo a transform.
 *
 * The linear part `[[a, c], [b, d]]` is inverted with the usual 2x2 formula
 * (swap the diagonal, negate the rest, divide by the determinant). The
 * translation is then whatever sends the original offset back to the origin:
 * e' = -(a' e + c' f), f' = -(b' e + d' f).
 *
 * @param m An invertible transform.
 * @returns The transform that maps every output of `m` back to its input.
 * @throws When `m` squashes the plane flat (determinant 0), which no editor
 *   transform should ever do.
 */
export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("Matrix is not invertible");
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/**
 * Transform a position (translation included).
 *
 * @param m The transform.
 * @param p A point.
 * @returns `m(p)`.
 */
export function applyToPoint(m: Matrix, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

/**
 * Transform a displacement (translation ignored). Use this for drag deltas
 * and sizes, which must not move when the origin moves.
 *
 * @param m The transform.
 * @param v A vector.
 * @returns The linear part of `m` applied to `v`.
 */
export function applyToVector(m: Matrix, v: Point): Point {
  const [a, b, c, d] = m;
  return { x: a * v.x + c * v.y, y: b * v.x + d * v.y };
}

/**
 * Format a transform for an SVG `transform` attribute.
 *
 * @param m The transform.
 * @returns For example `"matrix(1 0 0 1 10 20)"`.
 */
export function toSvgTransform(m: Matrix): string {
  return `matrix(${m.join(" ")})`;
}
