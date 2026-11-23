import { applyToPoint, type Matrix } from "@/lib/affine";
import type { UserRect } from "./margins";

/**
 * Checks that removing what lies outside the crop area left everything
 * inside it as it was. The worker renders and reads each cropped page of
 * the original (shown through the crop) and of the result with PDFium, and
 * these pure functions compare them:
 *
 * 1. Text: every character entirely inside the crop area must still be
 *    there, with the same code point, on the same baseline, and within
 *    `maxTextShift` of where it was. (PDFium rounds glyph widths, so text
 *    after removed glyphs may move by that bound in PDFium only; see
 *    `crates/pdf-crop/README.md`.)
 * 2. Everything else: rendered pixels must be identical away from text.
 *    Text is left to check 1 because the same tiny floating-point
 *    difference can change how a glyph is anti-aliased.
 */

/** A character as PDFium reads it from a page. */
export interface PageChar {
  /** Unicode code point (UTF-16 code unit as PDFium reports it). */
  unicode: number;
  /** Origin (pen position) in user space. */
  x: number;
  y: number;
  /** Tight box around the glyph in user space. */
  box: UserRect;
}

/** How far a character may move vertically and still be "the same", in points. */
export const BASELINE_TOLERANCE = 0.02;
/** How far it may move horizontally beyond the module's bound, in points. */
export const ADVANCE_TOLERANCE = 0.05;
/** Bitmap blocks are this many pixels square. */
export const BLOCK_SIZE = 8;
/** Pixels around a character's box that count as text (anti-aliasing). */
export const TEXT_MARGIN_PX = 2;
/** Largest mean channel difference allowed in a non-text block (of 255). */
export const MAX_BLOCK_DIFFERENCE = 2;

/** Why a page failed the check. */
export interface VerifyFailure {
  kind: "text" | "graphics";
  message: string;
}

/**
 * Whether `box` lies entirely within `crop`.
 *
 * @param box A box in user space.
 * @param crop The crop area in user space.
 * @returns True when nothing of `box` is outside.
 */
export function isInside(box: UserRect, crop: UserRect): boolean {
  return (
    box.left >= crop.left &&
    box.right <= crop.right &&
    box.bottom >= crop.bottom &&
    box.top <= crop.top
  );
}

/**
 * The characters of `before` that lie entirely inside the crop area but
 * have no match in `after`.
 *
 * Each character is matched to the nearest unused character of `after`
 * with the same code point whose origin is within `tolerance` in 2D Euclidean
 * distance. Using Euclidean distance accommodates horizontal text, rotated
 * text (e.g. 90° or 270°), and arbitrary orientations that drift with
 * fractional widths.
 * Candidates are grouped by code point first, so a page with thousands of
 * characters compares each only with the few that could match.
 *
 * @param before The original page's characters.
 * @param after The cropped page's characters.
 * @param crop The crop area in user space.
 * @param tolerance Position tolerance in points (Euclidean distance).
 * @returns The unmatched characters (empty when all are present).
 */
export function findMissingCharacters(
  before: readonly PageChar[],
  after: readonly PageChar[],
  crop: UserRect,
  tolerance: number,
): PageChar[] {
  const pool = new Map<number, PageChar[]>();
  for (const ch of after) {
    const list = pool.get(ch.unicode) ?? [];
    list.push(ch);
    pool.set(ch.unicode, list);
  }
  const missing: PageChar[] = [];
  for (const ch of before) {
    if (!isInside(ch.box, crop)) continue;
    const candidates = pool.get(ch.unicode) ?? [];
    let best = -1;
    let bestDistance = Infinity;
    candidates.forEach((c, i) => {
      // Euclidean distance in 2D space supports horizontal, rotated, and angled text.
      const distance = Math.hypot(c.x - ch.x, c.y - ch.y);
      if (distance <= tolerance && distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    if (best < 0) missing.push(ch);
    else candidates.splice(best, 1);
  }
  return missing;
}

/**
 * Mark the bitmap blocks that touch any text, so the pixel check can skip
 * them.
 *
 * @param boxes Character boxes in user space.
 * @param toPixel User space to bitmap pixels (y down).
 * @param width Bitmap width in pixels.
 * @param height Bitmap height in pixels.
 * @param margin Extra pixels around each box.
 * @returns One flag per block, row by row (1 = text).
 */
export function textBlockMask(
  boxes: readonly UserRect[],
  toPixel: Matrix,
  width: number,
  height: number,
  margin: number,
): Uint8Array {
  const columns = Math.ceil(width / BLOCK_SIZE);
  const rows = Math.ceil(height / BLOCK_SIZE);
  const mask = new Uint8Array(columns * rows);
  for (const box of boxes) {
    const a = applyToPoint(toPixel, { x: box.left, y: box.bottom });
    const b = applyToPoint(toPixel, { x: box.right, y: box.top });
    const x0 = Math.floor((Math.min(a.x, b.x) - margin) / BLOCK_SIZE);
    const x1 = Math.floor((Math.max(a.x, b.x) + margin) / BLOCK_SIZE);
    const y0 = Math.floor((Math.min(a.y, b.y) - margin) / BLOCK_SIZE);
    const y1 = Math.floor((Math.max(a.y, b.y) + margin) / BLOCK_SIZE);
    for (let y = Math.max(0, y0); y <= Math.min(rows - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(columns - 1, x1); x++) {
        mask[y * columns + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * The largest mean colour difference of any block not marked as text.
 *
 * For each pixel the largest of its R, G and B differences counts; a
 * block's value is the mean over its pixels. Alpha is ignored (both
 * bitmaps are painted on opaque white).
 *
 * @param a RGBA pixels of the original.
 * @param b RGBA pixels of the result, same size.
 * @param width Bitmap width in pixels.
 * @param height Bitmap height in pixels.
 * @param mask From {@link textBlockMask}.
 * @returns The worst block's mean difference (0..255).
 */
export function worstNonTextBlock(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  mask: Uint8Array,
): number {
  const columns = Math.ceil(width / BLOCK_SIZE);
  let worst = 0;
  for (let by = 0; by < height; by += BLOCK_SIZE) {
    for (let bx = 0; bx < width; bx += BLOCK_SIZE) {
      if (mask[(by / BLOCK_SIZE) * columns + bx / BLOCK_SIZE]) continue;
      let sum = 0;
      let count = 0;
      for (let y = by; y < Math.min(height, by + BLOCK_SIZE); y++) {
        for (let x = bx; x < Math.min(width, bx + BLOCK_SIZE); x++) {
          const o = (y * width + x) * 4;
          sum += Math.max(
            Math.abs(a[o] - b[o]),
            Math.abs(a[o + 1] - b[o + 1]),
            Math.abs(a[o + 2] - b[o + 2]),
          );
          count++;
        }
      }
      worst = Math.max(worst, sum / count);
    }
  }
  return worst;
}

/** Everything {@link verifyPage} compares for one page. */
export interface PageComparison {
  crop: UserRect;
  before: { chars: readonly PageChar[]; pixels: Uint8Array };
  after: { chars: readonly PageChar[]; pixels: Uint8Array };
  width: number;
  height: number;
  /** User space to bitmap pixels, for both renders. */
  toPixel: Matrix;
  /** The module's bound on text movement in PDFium, in points. */
  maxTextShift: number;
  /** Bitmap pixels per point. */
  scale: number;
}

/**
 * Check one cropped page (see the module comment).
 *
 * @param page The data of both renders.
 * @returns `null` when the crop area is unchanged, or what differs.
 */
export function verifyPage(page: PageComparison): VerifyFailure | null {
  const missing = findMissingCharacters(
    page.before.chars,
    page.after.chars,
    page.crop,
    page.maxTextShift + ADVANCE_TOLERANCE,
  );
  if (missing.length > 0) {
    const sample = missing
      .slice(0, 12)
      .map((c) => String.fromCharCode(c.unicode))
      .join("");
    return {
      kind: "text",
      message: `${missing.length} character${missing.length === 1 ? "" : "s"} inside the crop area changed ("${sample}")`,
    };
  }
  const mask = textBlockMask(
    page.before.chars.map((c) => c.box),
    page.toPixel,
    page.width,
    page.height,
    TEXT_MARGIN_PX + page.maxTextShift * page.scale,
  );
  const worst = worstNonTextBlock(
    page.before.pixels,
    page.after.pixels,
    page.width,
    page.height,
    mask,
  );
  if (worst > MAX_BLOCK_DIFFERENCE) {
    return {
      kind: "graphics",
      message: `the graphics inside the crop area changed (difference ${worst.toFixed(1)} of 255)`,
    };
  }
  return null;
}
