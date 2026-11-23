import { applyToPoint, invert, type Matrix } from "@/lib/affine";
import type { PageBox } from "@/lib/pdfium/page-box";

/** Axis-aligned rectangle inside a bitmap in top-down pixel coordinates. */
export interface PixelRect {
  /** Inclusive left pixel column (`0 <= left < width`). */
  left: number;
  /** Inclusive top pixel row (`0 <= top < height`). */
  top: number;
  /** Width in pixels (`>= 1`). */
  width: number;
  /** Height in pixels (`>= 1`). */
  height: number;
}

/**
 * Result of mapping user-space redaction boxes onto an image object's bitmap.
 *
 * - For axis-aligned image transforms (`b == 0 && c == 0`), `rects` gives exact
 *   top-down pixel rectangles ready for `FPDFBitmap_FillRect`.
 * - For rotated or skewed image transforms, `mask` provides a per-pixel test
 *   or exact list of pixel spans so diagonal boxes never over-blank unrelated pixels.
 */
export interface ImageRedactionPixels {
  /** Exact axis-aligned pixel rectangles (when image has no rotation/skew). */
  rects: PixelRect[];
  /** Individual pixel `(x, y)` coordinates when image is rotated or skewed. */
  points: { x: number; y: number }[];
}

/** Check whether a 2D point lies inside `box` (inclusive of edges). */
function pointInBox(x: number, y: number, box: PageBox): boolean {
  return x >= box.left && x <= box.right && y >= box.bottom && y <= box.top;
}

/**
 * Compute the bounding box of a PDF image object in page user space.
 *
 * Every PDF image stream occupies the unit square `[0, 1] x [0, 1]` in image
 * space, placed on the page by its object matrix `M = [a, b, c, d, e, f]`.
 *
 * @param matrix Image object transform `[a, b, c, d, e, f]`.
 * @returns Axis-aligned bounding box in user space.
 */
export function imageUserBounds(matrix: Matrix): PageBox {
  const corners = [
    applyToPoint(matrix, { x: 0, y: 0 }),
    applyToPoint(matrix, { x: 1, y: 0 }),
    applyToPoint(matrix, { x: 0, y: 1 }),
    applyToPoint(matrix, { x: 1, y: 1 }),
  ];
  return {
    left: Math.min(...corners.map((p) => p.x)),
    bottom: Math.min(...corners.map((p) => p.y)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.max(...corners.map((p) => p.y)),
  };
}

/**
 * Map a set of user-space redaction boxes into bitmap pixel coordinates for a
 * single PDF image object.
 *
 * Coordinate derivation:
 * - In PDF image space, `(u, v) in [0, 1]^2` has `(0, 0)` at the bottom-left
 *   and `(1, 1)` at the top-right.
 * - In a PDFium bitmap of size `(width, height)`, pixel `(px, py)` (with `py = 0`
 *   at the top row) corresponds to image-space center:
 *     `u = (px + 0.5) / width`
 *     `v = 1 - (py + 0.5) / height`
 * - Inverting `M` maps user-space corners back to `(u, v)` directly when the
 *   image has no shear/rotation (`|b| < 1e-6 && |c| < 1e-6`), yielding crisp
 *   pixel rectangles in `O(boxes.length)` time regardless of megapixel size.
 * - When the image is rotated or skewed, we iterate only over pixels whose
 *   mapped user-space center falls inside an overlapping redaction box.
 *
 * @param matrix Image object's user-space matrix `[a, b, c, d, e, f]`.
 * @param width Bitmap width in pixels.
 * @param height Bitmap height in pixels.
 * @param redactionBoxes User-space redaction boxes on the page.
 * @returns Pixel rectangles and/or coordinates to blank inside the bitmap.
 */
export function computeImageRedactionPixels(
  matrix: Matrix,
  width: number,
  height: number,
  redactionBoxes: readonly PageBox[],
): ImageRedactionPixels {
  if (width <= 0 || height <= 0 || redactionBoxes.length === 0) {
    return { rects: [], points: [] };
  }

  const bounds = imageUserBounds(matrix);
  const overlapping = redactionBoxes.filter(
    (b) =>
      b.right >= bounds.left &&
      b.left <= bounds.right &&
      b.top >= bounds.bottom &&
      b.bottom <= bounds.top,
  );
  if (overlapping.length === 0) {
    return { rects: [], points: [] };
  }

  let inv: Matrix;
  try {
    inv = invert(matrix);
  } catch {
    return { rects: [], points: [] };
  }

  const [, b, c] = matrix;
  const isAxisAligned = Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6;

  if (isAxisAligned) {
    const rects: PixelRect[] = [];
    for (const box of overlapping) {
      // Map all four user-space corners into image space [0, 1]^2 (handles negative
      // scale / flipped images cleanly).
      const uvs = [
        applyToPoint(inv, { x: box.left, y: box.bottom }),
        applyToPoint(inv, { x: box.right, y: box.bottom }),
        applyToPoint(inv, { x: box.left, y: box.top }),
        applyToPoint(inv, { x: box.right, y: box.top }),
      ];
      const uMin = Math.max(0, Math.min(...uvs.map((p) => p.x)));
      const uMax = Math.min(1, Math.max(...uvs.map((p) => p.x)));
      const vMin = Math.max(0, Math.min(...uvs.map((p) => p.y)));
      const vMax = Math.min(1, Math.max(...uvs.map((p) => p.y)));
      if (uMax <= uMin || vMax <= vMin) continue;

      // Convert image-space [uMin..uMax] x [vMin..vMax] to top-down pixel bounds.
      const pxLeft = Math.max(0, Math.floor(uMin * width));
      const pxRight = Math.min(width, Math.ceil(uMax * width));
      const pyTop = Math.max(0, Math.floor((1 - vMax) * height));
      const pyBottom = Math.min(height, Math.ceil((1 - vMin) * height));
      if (pxRight > pxLeft && pyBottom > pyTop) {
        rects.push({
          left: pxLeft,
          top: pyTop,
          width: pxRight - pxLeft,
          height: pyBottom - pyTop,
        });
      }
    }
    return { rects, points: [] };
  }

  // Rotated / skewed image fallback: evaluate pixel centers in user space.
  const points: { x: number; y: number }[] = [];
  for (let py = 0; py < height; py++) {
    const v = 1 - (py + 0.5) / height;
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const userPt = applyToPoint(matrix, { x: u, y: v });
      if (overlapping.some((box) => pointInBox(userPt.x, userPt.y, box))) {
        points.push({ x: px, y: py });
      }
    }
  }
  return { rects: [], points };
}
