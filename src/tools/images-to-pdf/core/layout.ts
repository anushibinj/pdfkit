import type { Matrix } from "@/lib/affine";
import { mmToPoints } from "@/lib/html-pdf/page-setup";
import type { QuarterTurns, Size } from "@/lib/pdfium/page-box";
import { FIXED_PAPER_POINTS, type PageLayoutOptions } from "./options";

/**
 * Maximum page dimension permitted by the PDF 1.7 specification (14,400 pt =
 * 200 inches). In "fit" mode, very large images are scaled down proportionally
 * so neither page edge exceeds this limit.
 */
export const MAX_PDF_PAGE_POINTS = 14400;

/**
 * Computed placement of one image on its PDF page: page dimensions and the
 * 2D affine matrix that transforms the PDF image unit square `[0,1] x [0,1]`
 * into its final rotated, scaled, and centered position in PDF user space.
 */
export interface PageLayout {
  /** Page width in PDF points (> 0). */
  pageWidth: number;
  /** Page height in PDF points (> 0). */
  pageHeight: number;
  /** Displayed image width in PDF points after rotation and scaling. */
  drawnWidth: number;
  /** Displayed image height in PDF points after rotation and scaling. */
  drawnHeight: number;
  /** Affine transform `[a, b, c, d, e, f]` for `FPDFPageObj_Transform`. */
  matrix: Matrix;
}

/**
 * Abstraction for computing page geometry and image placement (Dependency
 * Inversion Principle: the PDF builder depends on this contract rather than a
 * hard-coded layout implementation).
 */
export interface PageLayoutCalculator {
  /**
   * Compute the page dimensions and image affine transform for one image.
   *
   * @param pixelWidth Natural image width in pixels (> 0).
   * @param pixelHeight Natural image height in pixels (> 0).
   * @param rotation Clockwise quarter-turn rotation (`0 | 1 | 2 | 3`).
   * @param options Normalized page layout options.
   * @returns Computed page size and image transform matrix.
   */
  compute(
    pixelWidth: number,
    pixelHeight: number,
    rotation: QuarterTurns,
    options: PageLayoutOptions,
  ): PageLayout;
}

/**
 * Compute an image's displayed pixel dimensions after applying clockwise
 * quarter-turn rotation.
 *
 * Quarter turns 1 (90° CW) and 3 (270° CW) swap width and height; turns 0 and
 * 2 keep them unchanged.
 *
 * @param pixelWidth Natural image width in pixels (> 0).
 * @param pixelHeight Natural image height in pixels (> 0).
 * @param rotation Clockwise quarter turns (`0 | 1 | 2 | 3`).
 * @returns Effective `{ width, height }` in pixels after rotation.
 */
export function effectiveImageSize(
  pixelWidth: number,
  pixelHeight: number,
  rotation: QuarterTurns,
): Size {
  return rotation === 1 || rotation === 3
    ? { width: pixelHeight, height: pixelWidth }
    : { width: pixelWidth, height: pixelHeight };
}

/**
 * Scale a box proportionally so its longer side does not exceed `maxSide`.
 *
 * Used in "fit" mode so huge images (e.g. a 20,000 px panorama) remain valid
 * under PDF's 14,400 pt page limit without distorting their aspect ratio.
 *
 * @param width Unclamped width (> 0).
 * @param height Unclamped height (> 0).
 * @param maxSide Maximum allowed length for either side (> 0).
 * @returns Clamped `{ width, height }`.
 */
export function clampToMaxSide(
  width: number,
  height: number,
  maxSide: number = MAX_PDF_PAGE_POINTS,
): Size {
  const longer = Math.max(width, height);
  if (longer <= maxSide) return { width, height };
  const scale = maxSide / longer;
  return { width: width * scale, height: height * scale };
}

/**
 * Resolve the PDF page's width and height in points for one image.
 *
 * - In `"fit"` mode: the page matches the image's effective dimensions (at
 *   1 px = 1 pt, i.e., 72 DPI), plus twice the margin on each axis, then
 *   clamped to {@link MAX_PDF_PAGE_POINTS}.
 * - In fixed paper modes (`"A4"`, `"Letter"`, `"Legal"`): starts from the
 *   portrait paper dimensions and swaps width/height when orientation is
 *   `"landscape"`, or when orientation is `"auto"` and the rotated image is
 *   wider than it is tall (`effective.width > effective.height`).
 *
 * @param effective Rotated image dimensions in pixels.
 * @param options Normalized page layout options.
 * @returns Page `{ width, height }` in PDF points.
 */
export function resolvePageDimensions(
  effective: Size,
  options: PageLayoutOptions,
): Size {
  if (options.pageSize === "fit") {
    const marginPt = mmToPoints(options.marginMm);
    return clampToMaxSide(
      effective.width + marginPt * 2,
      effective.height + marginPt * 2,
    );
  }

  const base = FIXED_PAPER_POINTS[options.pageSize];
  const isLandscape =
    options.orientation === "landscape" ||
    (options.orientation === "auto" && effective.width > effective.height);

  return isLandscape
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/**
 * Build the 2D affine matrix `[a, b, c, d, e, f]` that maps a PDF image's unit
 * square `[0, 1] x [0, 1]` into `[left, left + drawnWidth] x [bottom, bottom + drawnHeight]`
 * with the requested clockwise rotation.
 *
 * Detailed derivation in PDF user space (origin at bottom-left, +x right, +y up):
 *
 * A PDF image XObject natively occupies the unit square where:
 *   - `(0, 0)` = image bottom-left pixel
 *   - `(1, 0)` = image bottom-right pixel
 *   - `(0, 1)` = image top-left pixel
 *   - `(1, 1)` = image top-right pixel
 *
 * `FPDFPageObj_Transform(obj, a, b, c, d, e, f)` applies:
 *   `x' = a * x + c * y + e`
 *   `y' = b * x + d * y + f`
 *
 * For each clockwise rotation `turns`, we map the 4 unit corners to the target
 * rectangle corners (verifying determinant `a*d - b*c = +drawnWidth * drawnHeight > 0`
 * so the image is never mirrored):
 *
 * - `0` (0°):
 *     `(0,0)->(left, bottom)`, `(1,0)->(left+W, bottom)`, `(0,1)->(left, bottom+H)`
 *     => `[W, 0, 0, H, left, bottom]`
 * - `1` (90° CW):
 *     `(0,0)->(left, bottom+H)`, `(1,0)->(left, bottom)`, `(0,1)->(left+W, bottom+H)`
 *     => `[0, -H, W, 0, left, bottom + H]`
 * - `2` (180°):
 *     `(0,0)->(left+W, bottom+H)`, `(1,0)->(left, bottom+H)`, `(0,1)->(left+W, bottom)`
 *     => `[-W, 0, 0, -H, left + W, bottom + H]`
 * - `3` (270° CW / 90° CCW):
 *     `(0,0)->(left+W, bottom)`, `(1,0)->(left+W, bottom+H)`, `(0,1)->(left, bottom)`
 *     => `[0, H, -W, 0, left + W, bottom]`
 *
 * @param left X coordinate of the placed image's left edge in PDF points.
 * @param bottom Y coordinate of the placed image's bottom edge in PDF points.
 * @param drawnWidth Displayed width of the placed image in PDF points.
 * @param drawnHeight Displayed height of the placed image in PDF points.
 * @param rotation Clockwise quarter turns (`0 | 1 | 2 | 3`).
 * @returns 6-element affine transformation matrix.
 */
export function computeImageMatrix(
  left: number,
  bottom: number,
  drawnWidth: number,
  drawnHeight: number,
  rotation: QuarterTurns,
): Matrix {
  switch (rotation) {
    case 0:
      return [drawnWidth, 0, 0, drawnHeight, left, bottom];
    case 1:
      return [0, -drawnHeight, drawnWidth, 0, left, bottom + drawnHeight];
    case 2:
      return [
        -drawnWidth,
        0,
        0,
        -drawnHeight,
        left + drawnWidth,
        bottom + drawnHeight,
      ];
    case 3:
      return [0, drawnHeight, -drawnWidth, 0, left + drawnWidth, bottom];
  }
}

/**
 * Compute the complete page dimensions and image transform matrix for one
 * image given its natural pixel size, rotation, and layout options.
 *
 * Scaling rules inside the printable box `(pageWidth - 2*margin) x (pageHeight - 2*margin)`:
 * - First, margin is clamped to at most 45% of the shorter page edge so the
 *   printable area is always strictly positive even on tiny custom images.
 * - In `"contain"` mode (or `"fit"` page size): scales the image uniformly by
 *   `min(availW / effective.width, availH / effective.height)` so it fills as
 *   much of the printable box as possible without cropping or distorting.
 * - In `"actual"` mode (on fixed paper sizes): uses `scale = min(1, containScale)`
 *   so small images render at their natural 72 DPI size (1 px = 1 pt) while
 *   oversized images still shrink cleanly to stay inside the page margins.
 * - Finally, the image is centered both horizontally and vertically on the page.
 *
 * @param pixelWidth Natural image width in pixels (> 0).
 * @param pixelHeight Natural image height in pixels (> 0).
 * @param rotation Clockwise quarter-turn rotation (`0 | 1 | 2 | 3`).
 * @param options Normalized page layout options.
 * @returns Complete {@link PageLayout} ready for PDFium page creation.
 * @throws {RangeError} When `pixelWidth` or `pixelHeight` is not a positive finite number.
 */
export function computePageLayout(
  pixelWidth: number,
  pixelHeight: number,
  rotation: QuarterTurns,
  options: PageLayoutOptions,
): PageLayout {
  if (
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(pixelHeight) ||
    pixelWidth <= 0 ||
    pixelHeight <= 0
  ) {
    throw new RangeError(
      `Image dimensions must be positive numbers (got ${pixelWidth} x ${pixelHeight}).`,
    );
  }

  const effective = effectiveImageSize(pixelWidth, pixelHeight, rotation);
  const page = resolvePageDimensions(effective, options);

  // Guard against margins consuming the entire page (e.g. a tiny image in "fit"
  // mode that got clamped, or an extreme margin setting).
  const requestedMargin = mmToPoints(options.marginMm);
  const maxSafeMargin = Math.min(page.width, page.height) * 0.45;
  const marginPt = Math.min(requestedMargin, maxSafeMargin);

  const availWidth = page.width - marginPt * 2;
  const availHeight = page.height - marginPt * 2;

  const containScale = Math.min(
    availWidth / effective.width,
    availHeight / effective.height,
  );
  const scale =
    options.pageSize !== "fit" && options.scaleMode === "actual"
      ? Math.min(1, containScale)
      : containScale;

  const drawnWidth = effective.width * scale;
  const drawnHeight = effective.height * scale;

  // Center the drawn box inside the page (equivalently inside the symmetric
  // margin box).
  const left = (page.width - drawnWidth) / 2;
  const bottom = (page.height - drawnHeight) / 2;

  return {
    pageWidth: page.width,
    pageHeight: page.height,
    drawnWidth,
    drawnHeight,
    matrix: computeImageMatrix(left, bottom, drawnWidth, drawnHeight, rotation),
  };
}

/**
 * Default {@link PageLayoutCalculator} implementation delegating to
 * {@link computePageLayout}.
 */
export class StandardPageLayoutCalculator implements PageLayoutCalculator {
  /**
   * Compute page geometry and image placement matrix.
   *
   * @param pixelWidth Natural image width in pixels (> 0).
   * @param pixelHeight Natural image height in pixels (> 0).
   * @param rotation Clockwise quarter-turn rotation.
   * @param options Normalized page layout options.
   * @returns Computed {@link PageLayout}.
   */
  compute(
    pixelWidth: number,
    pixelHeight: number,
    rotation: QuarterTurns,
    options: PageLayoutOptions,
  ): PageLayout {
    return computePageLayout(pixelWidth, pixelHeight, rotation, options);
  }
}
