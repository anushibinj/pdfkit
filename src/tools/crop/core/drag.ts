import type { Point } from "@/lib/geometry/affine";
import type { Size } from "@/lib/geometry/page-geometry";
import { MIN_CROP_SIZE, type ViewRect } from "./margins";

/**
 * What a pointer grabbed on the crop rectangle: the inside (to move it) or
 * one of its edges or corners, named by compass direction (`n` is the top
 * edge, `se` the bottom-right corner).
 */
export type DragHandle =
  "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Every handle that resizes, in the order they are drawn. */
export const RESIZE_HANDLES: readonly Exclude<DragHandle, "move">[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/**
 * The rectangle after dragging `handle` by `delta` (view points).
 *
 * How it is computed:
 * - Moving shifts the rectangle and then pushes it back inside the page,
 *   so it keeps its size and stops at the edges.
 * - Resizing moves only the grabbed edges. Each moving edge is clamped
 *   between the page edge and the opposite edge minus `minSize`, so the
 *   rectangle can never leave the page, turn inside out, or become
 *   smaller than {@link MIN_CROP_SIZE}.
 *
 * Working from the rectangle where the drag started (not the previous
 * pointer event) keeps the result exact however many events arrive.
 *
 * @param start The rectangle when the drag began.
 * @param handle What was grabbed.
 * @param delta Pointer movement since the drag began, in view points.
 * @param page The displayed page size (the rectangle's bounds).
 * @param minSize Smallest width and height allowed.
 * @returns The new rectangle.
 */
export function dragRect(
  start: ViewRect,
  handle: DragHandle,
  delta: Point,
  page: Size,
  minSize = MIN_CROP_SIZE,
): ViewRect {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + delta.x, 0, page.width - start.width),
      y: clamp(start.y + delta.y, 0, page.height - start.height),
    };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = clamp(left + delta.x, 0, right - minSize);
  if (handle.includes("e"))
    right = clamp(right + delta.x, left + minSize, page.width);
  if (handle.includes("n")) top = clamp(top + delta.y, 0, bottom - minSize);
  if (handle.includes("s"))
    bottom = clamp(bottom + delta.y, top + minSize, page.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The cursor that shows what dragging a handle does.
 *
 * @param handle The handle.
 * @returns A CSS cursor name.
 */
export function cursorFor(handle: DragHandle): string {
  switch (handle) {
    case "move":
      return "move";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
  }
}

/**
 * Where a handle sits on a rectangle (the middle of its edge, or the
 * corner).
 *
 * @param rect The rectangle.
 * @param handle A resize handle.
 * @returns The handle's centre.
 */
export function handlePosition(
  rect: ViewRect,
  handle: Exclude<DragHandle, "move">,
): Point {
  const x = handle.includes("w")
    ? rect.x
    : handle.includes("e")
      ? rect.x + rect.width
      : rect.x + rect.width / 2;
  const y = handle.includes("n")
    ? rect.y
    : handle.includes("s")
      ? rect.y + rect.height
      : rect.y + rect.height / 2;
  return { x, y };
}

/**
 * `value` limited to `min..max` (`min` wins if the range is empty).
 *
 * @param value Any number.
 * @param min Lower bound.
 * @param max Upper bound.
 * @returns The clamped number.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
