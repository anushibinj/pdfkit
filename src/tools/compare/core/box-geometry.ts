/**
 * Pure geometry helpers for converting PDF user-space character bounds into
 * clean, line-merged highlight rectangles, normalised view-space rects, and
 * PDF `QuadPoints` arrays for highlight annotations.
 */
import { applyToPoint } from "@/lib/affine";
import {
  userToView,
  viewSize,
  type PageBox,
  type PageInfo,
} from "@/lib/pdfium/page-box";
import type { NormalizedRect } from "./model";

/** Minimum vertical overlap ratio required to treat two boxes as the same line. */
const LINE_VERTICAL_OVERLAP_RATIO = 0.4;

/** Maximum horizontal gap multiplier (relative to line height) to merge adjacent glyphs. */
const MAX_HORIZONTAL_MERGE_GAP_FACTOR = 1.6;

/** Minimum side dimension in user space to avoid zero-area annotation rects. */
const MIN_BOX_DIMENSION = 1e-3;

/**
 * Return the union (smallest enclosing axis-aligned bounding box) of two boxes.
 *
 * @param a First bounding box in PDF user space.
 * @param b Second bounding box in PDF user space.
 * @returns The combined bounding box enclosing both `a` and `b`.
 */
export function unionUserBox(a: PageBox, b: PageBox): PageBox {
  return {
    left: Math.min(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
    top: Math.max(a.top, b.top),
  };
}

/**
 * Return the union of two normalised view-space rectangles.
 *
 * @param a First normalised rectangle.
 * @param b Second normalised rectangle.
 * @returns Enclosing normalised rectangle.
 */
export function unionViewRect(
  a: NormalizedRect,
  b: NormalizedRect,
): NormalizedRect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * Test whether two PDF user-space boxes sit on the same horizontal line and are
 * close enough horizontally to merge into a single highlight bar.
 *
 * @param current Running merged box on the current line.
 * @param candidate Next character or word box in reading order.
 * @returns True when `candidate` should be merged into `current`.
 */
export function canMergeUserBoxesOnLine(
  current: PageBox,
  candidate: PageBox,
): boolean {
  const currentHeight = Math.max(MIN_BOX_DIMENSION, current.top - current.bottom);
  const candidateHeight = Math.max(
    MIN_BOX_DIMENSION,
    candidate.top - candidate.bottom,
  );
  const overlapY =
    Math.min(current.top, candidate.top) -
    Math.max(current.bottom, candidate.bottom);
  const minHeight = Math.min(currentHeight, candidateHeight);
  if (overlapY / minHeight < LINE_VERTICAL_OVERLAP_RATIO) {
    return false;
  }

  const lineHeight = Math.max(currentHeight, candidateHeight);
  // Horizontal gap is 0 when the boxes touch or overlap horizontally.
  const horizontalGap = Math.max(
    candidate.left - current.right,
    current.left - candidate.right,
    0,
  );
  return horizontalGap <= lineHeight * MAX_HORIZONTAL_MERGE_GAP_FACTOR;
}

/**
 * Merge a list of PDF user-space glyph boxes into clean, per-line rectangles.
 *
 * @param boxes Ordered character boxes in PDF user space.
 * @returns Line-merged bounding boxes in PDF user space.
 */
export function mergeUserBoxesByLine(boxes: readonly PageBox[]): PageBox[] {
  const merged: PageBox[] = [];
  for (const box of boxes) {
    if (box.right <= box.left && box.top <= box.bottom) continue;
    const last = merged[merged.length - 1];
    if (last && canMergeUserBoxesOnLine(last, box)) {
      merged[merged.length - 1] = unionUserBox(last, box);
    } else {
      merged.push({ ...box });
    }
  }
  return merged;
}

/**
 * Convert a PDF user-space rectangle into a normalised view-space rectangle
 * (`[0..1]`, top-left origin, `y` down), accounting for the page's CropBox
 * offset and `/Rotate` quarter turns.
 *
 * @param box Bounding box in PDF user space.
 * @param info Page bounding box and `/Rotate` metadata.
 * @returns Normalised display rectangle clamped to `[0, 1]`.
 */
export function userBoxToNormalizedViewRect(
  box: PageBox,
  info: PageInfo,
): NormalizedRect {
  const view = viewSize(info.box, info.rotation);
  const width = Math.max(MIN_BOX_DIMENSION, view.width);
  const height = Math.max(MIN_BOX_DIMENSION, view.height);
  const toView = userToView(info.box, info.rotation);

  const p1 = applyToPoint(toView, { x: box.left, y: box.bottom });
  const p2 = applyToPoint(toView, { x: box.right, y: box.top });

  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  return {
    left: clamp01(Math.min(p1.x, p2.x) / width),
    top: clamp01(Math.min(p1.y, p2.y) / height),
    right: clamp01(Math.max(p1.x, p2.x) / width),
    bottom: clamp01(Math.max(p1.y, p2.y) / height),
  };
}

/**
 * Merge normalised view-space rectangles that lie on the same visual line.
 *
 * @param rects Ordered normalised view-space rectangles.
 * @returns Line-merged normalised view-space rectangles.
 */
export function mergeNormalizedViewRects(
  rects: readonly NormalizedRect[],
): NormalizedRect[] {
  const merged: NormalizedRect[] = [];
  for (const rect of rects) {
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
    const last = merged[merged.length - 1];
    if (last) {
      const h1 = Math.max(1e-4, last.bottom - last.top);
      const h2 = Math.max(1e-4, rect.bottom - rect.top);
      const overlapY =
        Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top);
      const lineH = Math.max(h1, h2);
      const gapX = Math.max(rect.left - last.right, last.left - rect.right, 0);
      if (
        overlapY / Math.min(h1, h2) >= LINE_VERTICAL_OVERLAP_RATIO &&
        gapX <= lineH * MAX_HORIZONTAL_MERGE_GAP_FACTOR
      ) {
        merged[merged.length - 1] = unionViewRect(last, rect);
        continue;
      }
    }
    merged.push({ ...rect });
  }
  return merged;
}

/**
 * Convert an array of user-space character boxes into line-merged normalised
 * view-space rectangles suitable for UI highlight overlays.
 *
 * @param boxes User-space character boxes.
 * @param info Page bounding box and rotation.
 * @returns Line-merged normalised view-space rectangles.
 */
export function userBoxesToNormalizedViewRects(
  boxes: readonly PageBox[],
  info: PageInfo,
): NormalizedRect[] {
  const viewRects = boxes
    .filter((b) => b.right > b.left && b.top > b.bottom)
    .map((b) => userBoxToNormalizedViewRect(b, info));
  return mergeNormalizedViewRects(viewRects);
}

/**
 * Convert a PDF user-space rectangle into an 8-float `FS_QUADPOINTSF` tuple in
 * PDF specification order: top-left, top-right, bottom-left, bottom-right.
 *
 * @param box Highlight rectangle in PDF user space.
 * @returns Tuple `[x1, y1, x2, y2, x3, y3, x4, y4]`.
 */
export function userBoxToQuadPoints(
  box: PageBox,
): [number, number, number, number, number, number, number, number] {
  return [
    box.left,
    box.top,
    box.right,
    box.top,
    box.left,
    box.bottom,
    box.right,
    box.bottom,
  ];
}

/**
 * Compute the bounding box enclosing an array of PDF user-space boxes, or
 * `null` when the array is empty.
 *
 * @param boxes Non-empty or empty array of user-space boxes.
 * @returns Combined enclosing box, or `null`.
 */
export function boundsOfUserBoxes(boxes: readonly PageBox[]): PageBox | null {
  if (boxes.length === 0) return null;
  let acc = { ...boxes[0] };
  for (let i = 1; i < boxes.length; i++) {
    acc = unionUserBox(acc, boxes[i]);
  }
  return acc;
}

/**
 * Compute the vertical scroll anchor (`0..1`) for a change hunk from its
 * normalised view rectangles, defaulting to `0` when no rectangles exist.
 *
 * @param rects Highlight rectangles in normalised view space.
 * @returns Top-most normalised `y` coordinate in `[0, 1]`.
 */
export function rectAnchorY(rects: readonly NormalizedRect[]): number {
  if (rects.length === 0) return 0;
  let minTop = rects[0].top;
  for (let i = 1; i < rects.length; i++) {
    if (rects[i].top < minTop) minTop = rects[i].top;
  }
  return minTop;
}
