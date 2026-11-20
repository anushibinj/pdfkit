import { applyToPoint, applyToVector } from "./affine";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_INK_COLOR,
  DEFAULT_TEXT_COLOR,
} from "./colors";
import type { ObjectPatch } from "./editor-state";
import {
  MAX_INK_POINTS,
  type BoxObject,
  type EditObject,
  type FontFamily,
  type ImageAsset,
  type ImageObject,
  type ObjectFrame,
  type PageBox,
  type Point,
  type QuarterTurns,
  type Rgb,
  type TextObject,
} from "./model";
import { uprightFrameAt, viewToObject } from "./object-frame";
import { viewSize, viewToUser } from "./page-geometry";

/** Tools that react to pointer input on a page. */
export type DrawingTool =
  | "select"
  /** Click a line of the PDF's own text to change it in place. */
  | "edit-text"
  | "text"
  | "ink"
  | "rect"
  | "highlight";

/** Box kinds drawn by dragging a rectangle. */
export type BoxTool = "rect" | "highlight";

/** Style applied to newly created objects. */
export interface ToolStyle {
  /** Text, pen and outline colour. */
  color: Rgb;
  textColor: Rgb;
  highlightColor: Rgb;
  font: FontFamily;
  fontSize: number;
  strokeWidth: number;
}

/** Starting style: black 14 pt sans text, a 2 pt blue pen, yellow marker. */
export const DEFAULT_TOOL_STYLE: ToolStyle = {
  color: DEFAULT_INK_COLOR,
  textColor: DEFAULT_TEXT_COLOR,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  font: "sans",
  fontSize: 14,
  strokeWidth: 2,
};

/** The page a gesture happens on: its box and its displayed rotation. */
export interface GesturePage {
  box: PageBox;
  /** Clockwise display turns (page /Rotate plus user rotation). */
  turns: QuarterTurns;
}

/** Text placed by the text tool, ready to be typed over. */
export const DEFAULT_TEXT = "Text";
/** A drag shorter than this (points, both directions) counts as a click. */
export const CLICK_TOLERANCE = 3;
/** Smallest width or height a box can be resized to, in points. */
export const MIN_OBJECT_SIZE = 4;
/** Ink points closer than this to the previous point are skipped. */
export const MIN_INK_STEP = 1;
/** Size of a box created by a plain click instead of a drag. */
export const DEFAULT_BOX_SIZE: Record<
  BoxTool,
  { width: number; height: number }
> = {
  rect: { width: 120, height: 60 },
  highlight: { width: 120, height: 18 },
};
/** Default width of a placed image, as a share of the displayed page width. */
export const IMAGE_WIDTH_SHARE = 0.4;
/** Tallest a newly placed image may be, as a share of the page height. */
export const IMAGE_MAX_HEIGHT_SHARE = 0.8;

/** A pointer interaction in progress. */
export type Gesture =
  | {
      kind: "draw-ink";
      /** Frame of the stroke being drawn (upright at the first point). */
      frame: Pick<ObjectFrame, "x" | "y" | "rotation">;
      /** Points so far, in the stroke's local space. */
      points: Point[];
    }
  | {
      kind: "draw-box";
      tool: BoxTool;
      /** Where the drag started and where the pointer is now (view space). */
      start: Point;
      current: Point;
    }
  | { kind: "move"; object: EditObject; start: Point; current: Point }
  | { kind: "resize"; object: BoxObject; start: Point; current: Point };

/** What a finished gesture asks the editor to do. */
export type GestureOutcome =
  | { type: "add"; object: EditObject }
  | { type: "update"; objectId: string; patch: ObjectPatch }
  | null;

/**
 * Convert a pointer position to view space (points from the displayed page's
 * top-left corner).
 *
 * The overlay is drawn with an SVG `viewBox` in points and stretched to the
 * element's CSS size, so one CSS pixel is `viewWidth / rect.width` points.
 *
 * @param client The pointer's `clientX`/`clientY`.
 * @param rect The overlay element's `getBoundingClientRect()`.
 * @param view The displayed page size in points.
 * @returns The pointer position in view space.
 */
export function clientToViewPoint(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  view: { width: number; height: number },
): Point {
  const sx = rect.width > 0 ? view.width / rect.width : 1;
  const sy = rect.height > 0 ? view.height / rect.height : 1;
  return { x: (client.x - rect.left) * sx, y: (client.y - rect.top) * sy };
}

/**
 * A new text object at a clicked point, upright on screen, holding
 * {@link DEFAULT_TEXT} so it is visible and can be typed over.
 *
 * @param id Id for the new object.
 * @param at Click position in view space (becomes the text's top-left).
 * @param page The page clicked on.
 * @param style Current tool style.
 * @returns The text object.
 */
export function createTextObject(
  id: string,
  at: Point,
  page: GesturePage,
  style: ToolStyle,
): TextObject {
  return {
    id,
    kind: "text",
    ...uprightFrameAt(at, page.box, page.turns),
    text: DEFAULT_TEXT,
    font: style.font,
    fontSize: style.fontSize,
    color: style.textColor,
  };
}

/**
 * A new image object at a clicked point, upright on screen, keeping the
 * picture's aspect ratio and lying entirely on the page.
 *
 * Sizing: the width starts at {@link IMAGE_WIDTH_SHARE} of the displayed
 * page width, so it is a sensible size on any paper. A tall picture (a
 * portrait scan, say) could then be taller than the page, so if the height
 * exceeds {@link IMAGE_MAX_HEIGHT_SHARE} of the page height it is sized by
 * height instead. Both sides scale together, so the aspect ratio holds.
 *
 * Placement: the click becomes the top-left corner, except near the right
 * or bottom edge, where the corner is moved back just far enough for the
 * whole picture to fit. Anything off the page would be cut off in the
 * saved file.
 *
 * @param id Id for the new object.
 * @param at Click position in view space.
 * @param page The page clicked on.
 * @param asset The picture.
 * @returns The image object.
 */
export function createImageObject(
  id: string,
  at: Point,
  page: GesturePage,
  asset: Pick<ImageAsset, "id" | "pixelWidth" | "pixelHeight">,
): ImageObject {
  const view = viewSize(page.box, page.turns);
  const aspect =
    asset.pixelWidth > 0 && asset.pixelHeight > 0
      ? asset.pixelHeight / asset.pixelWidth
      : 1;
  let width = view.width * IMAGE_WIDTH_SHARE;
  let height = width * aspect;
  const maxHeight = view.height * IMAGE_MAX_HEIGHT_SHARE;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspect;
  }
  const topLeft = {
    x: Math.max(0, Math.min(at.x, view.width - width)),
    y: Math.max(0, Math.min(at.y, view.height - height)),
  };
  return {
    id,
    kind: "image",
    ...uprightFrameAt(topLeft, page.box, page.turns),
    width,
    height,
    imageId: asset.id,
  };
}

/**
 * Begin a freehand stroke. Its frame is upright at the first point, so the
 * first local point is (0, 0).
 *
 * @param at Pointer position in view space.
 * @param page The page being drawn on.
 * @returns The gesture.
 */
export function startInk(at: Point, page: GesturePage): Gesture {
  return {
    kind: "draw-ink",
    frame: uprightFrameAt(at, page.box, page.turns),
    points: [{ x: 0, y: 0 }],
  };
}

/**
 * Follow the pointer.
 *
 * For a stroke, the pointer is converted into the stroke's local space and
 * appended, unless it is within {@link MIN_INK_STEP} of the previous point
 * (pointer events can fire many times per point of movement; skipping those
 * keeps strokes small without visible loss) or the stroke is full. For every
 * other gesture only the current position is remembered; the result is
 * computed from start and current on demand.
 *
 * @param gesture The gesture in progress.
 * @param at Pointer position in view space.
 * @param page The page the gesture started on.
 * @returns The updated gesture (the same object when nothing changed).
 */
export function updateGesture(
  gesture: Gesture,
  at: Point,
  page: GesturePage,
): Gesture {
  if (gesture.kind !== "draw-ink") return { ...gesture, current: at };
  const local = applyToPoint(
    viewToObject(gesture.frame, page.box, page.turns),
    at,
  );
  const last = gesture.points[gesture.points.length - 1];
  if (
    Math.hypot(local.x - last.x, local.y - last.y) < MIN_INK_STEP ||
    gesture.points.length >= MAX_INK_POINTS
  ) {
    return gesture;
  }
  return { ...gesture, points: [...gesture.points, local] };
}

/**
 * Object for a dragged rectangle (or a click) with a box tool.
 *
 * The drag can go in any direction, so the top-left corner is the minimum of
 * the two points on each axis. A drag smaller than {@link CLICK_TOLERANCE}
 * in both directions is treated as a click and gets {@link DEFAULT_BOX_SIZE}
 * at the click point, which also makes the tools usable without dragging.
 * The new box is upright on screen, so its local axes equal the view axes
 * and the view extents are its width and height.
 *
 * @param id Id for the object.
 * @param tool Which box tool.
 * @param start Drag start in view space.
 * @param end Drag end in view space.
 * @param page The page.
 * @param style Current tool style.
 * @returns The box object.
 */
export function boxFromDrag(
  id: string,
  tool: BoxTool,
  start: Point,
  end: Point,
  page: GesturePage,
  style: ToolStyle,
): BoxObject {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const click = dx < CLICK_TOLERANCE && dy < CLICK_TOLERANCE;
  const topLeft = click
    ? start
    : { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
  const size = click ? DEFAULT_BOX_SIZE[tool] : { width: dx, height: dy };
  const frame = {
    id,
    ...uprightFrameAt(topLeft, page.box, page.turns),
    ...size,
  };
  switch (tool) {
    case "rect":
      return {
        ...frame,
        kind: "rect",
        color: style.color,
        strokeWidth: style.strokeWidth,
      };
    case "highlight":
      return { ...frame, kind: "highlight", color: style.highlightColor };
  }
}

/**
 * New position of an object dragged by a view-space distance.
 *
 * The drag distance is measured on screen, but the object's position is in
 * user space, which may be flipped and rotated relative to the screen. Only
 * the linear part of the view-to-user transform applies to a distance (a
 * distance has no origin), hence `applyToVector`.
 *
 * @param object The object being moved.
 * @param delta Drag distance in view space.
 * @param page The page.
 * @returns The new `x` and `y`.
 */
export function moveBy(
  object: Pick<ObjectFrame, "x" | "y">,
  delta: Point,
  page: GesturePage,
): { x: number; y: number } {
  const d = applyToVector(viewToUser(page.box, page.turns), delta);
  return { x: object.x + d.x, y: object.y + d.y };
}

/**
 * New size of a box whose bottom-right handle was dragged.
 *
 * The drag distance is converted into the box's own local axes (a box placed
 * before the page was rotated is turned on screen, so "right" on screen may
 * be "down" for the box). Sizes never shrink below {@link MIN_OBJECT_SIZE}.
 * Images keep their aspect ratio by applying the larger of the two scale
 * factors to both sides, which feels natural whichever way the user drags.
 *
 * @param object The box being resized.
 * @param delta Drag distance in view space.
 * @param page The page.
 * @returns The new `width` and `height`.
 */
export function resizeBy(
  object: BoxObject,
  delta: Point,
  page: GesturePage,
): { width: number; height: number } {
  const d = applyToVector(viewToObject(object, page.box, page.turns), delta);
  let width = Math.max(MIN_OBJECT_SIZE, object.width + d.x);
  let height = Math.max(MIN_OBJECT_SIZE, object.height + d.y);
  if (object.kind === "image") {
    const scale = Math.max(width / object.width, height / object.height);
    width = Math.max(MIN_OBJECT_SIZE, object.width * scale);
    height = Math.max(MIN_OBJECT_SIZE, object.height * scale);
  }
  return { width, height };
}

/**
 * What the gesture would produce if the pointer were released now: drawn
 * live on the page while the gesture runs.
 *
 * @param gesture The gesture in progress.
 * @param page The page.
 * @param style Current tool style.
 * @param id Id to give a new object.
 * @returns The object to preview.
 */
export function previewObject(
  gesture: Gesture,
  page: GesturePage,
  style: ToolStyle,
  id: string,
): EditObject {
  switch (gesture.kind) {
    case "draw-ink":
      return {
        id,
        kind: "ink",
        ...gesture.frame,
        points: gesture.points,
        color: style.color,
        strokeWidth: style.strokeWidth,
      };
    case "draw-box":
      return boxFromDrag(
        id,
        gesture.tool,
        gesture.start,
        gesture.current,
        page,
        style,
      );
    case "move": {
      const delta = {
        x: gesture.current.x - gesture.start.x,
        y: gesture.current.y - gesture.start.y,
      };
      return { ...gesture.object, ...moveBy(gesture.object, delta, page) };
    }
    case "resize": {
      const delta = {
        x: gesture.current.x - gesture.start.x,
        y: gesture.current.y - gesture.start.y,
      };
      return { ...gesture.object, ...resizeBy(gesture.object, delta, page) };
    }
  }
}

/**
 * Turn a released gesture into an edit.
 *
 * - Strokes and boxes become new objects (a single-point stroke is a dot).
 * - A move or resize becomes an update of the object, unless the pointer
 *   barely moved: then it was a click that only selected the object, and
 *   no undo step should be recorded.
 *
 * @param gesture The finished gesture.
 * @param page The page.
 * @param style Current tool style.
 * @param id Id to give a new object.
 * @returns The edit to apply, or `null` for none.
 */
export function finishGesture(
  gesture: Gesture,
  page: GesturePage,
  style: ToolStyle,
  id: string,
): GestureOutcome {
  const object = previewObject(gesture, page, style, id);
  if (gesture.kind === "draw-ink" || gesture.kind === "draw-box") {
    return { type: "add", object };
  }
  const moved =
    Math.abs(gesture.current.x - gesture.start.x) >= 0.5 ||
    Math.abs(gesture.current.y - gesture.start.y) >= 0.5;
  if (!moved) return null;
  if (gesture.kind === "move") {
    return {
      type: "update",
      objectId: gesture.object.id,
      patch: { x: object.x, y: object.y },
    };
  }
  const resized = object as BoxObject;
  return {
    type: "update",
    objectId: gesture.object.id,
    patch: { width: resized.width, height: resized.height },
  };
}
