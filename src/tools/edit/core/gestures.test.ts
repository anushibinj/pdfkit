import { describe, expect, it } from "vitest";
import { applyToPoint } from "./affine";
import {
  CLICK_TOLERANCE,
  DEFAULT_BOX_SIZE,
  DEFAULT_TEXT,
  DEFAULT_TOOL_STYLE,
  IMAGE_WIDTH_SHARE,
  MIN_OBJECT_SIZE,
  boxFromDrag,
  clientToViewPoint,
  createImageObject,
  createTextObject,
  finishGesture,
  moveBy,
  previewObject,
  resizeBy,
  startInk,
  updateGesture,
  type Gesture,
  type GesturePage,
} from "./gestures";
import type { ImageObject, RectObject } from "./model";
import { objectToView } from "./object-frame";

const box = { left: 0, bottom: 0, right: 600, top: 400 };
const flat: GesturePage = { box, turns: 0 };
const turned: GesturePage = { box, turns: 1 }; // displayed 400 wide, 600 tall
const style = DEFAULT_TOOL_STYLE;
const round = (p: { x: number; y: number }) => ({
  x: Math.round(p.x * 1000) / 1000 + 0,
  y: Math.round(p.y * 1000) / 1000 + 0,
});
/** Where an object's local origin appears on screen. */
const originOnScreen = (
  o: { x: number; y: number; rotation: 0 | 1 | 2 | 3 },
  page: GesturePage,
) => round(applyToPoint(objectToView(o, page.box, page.turns), { x: 0, y: 0 }));

describe("clientToViewPoint", () => {
  it("scales CSS pixels to points relative to the overlay", () => {
    const rect = { left: 100, top: 50, width: 300, height: 200 };
    expect(
      clientToViewPoint({ x: 250, y: 150 }, rect, { width: 600, height: 400 }),
    ).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("does not divide by zero for an unlaid-out element", () => {
    expect(
      clientToViewPoint(
        { x: 5, y: 6 },
        { left: 0, top: 0, width: 0, height: 0 },
        { width: 1, height: 1 },
      ),
    ).toEqual({ x: 5, y: 6 });
  });
});

describe("createTextObject", () => {
  it("places default text upright at the click, in the current style", () => {
    const t = createTextObject("t", { x: 30, y: 40 }, turned, style);
    expect(t).toMatchObject({
      kind: "text",
      text: DEFAULT_TEXT,
      rotation: 1,
      fontSize: 14,
    });
    expect(t.color).toEqual(style.textColor);
    expect(originOnScreen(t, turned)).toEqual({ x: 30, y: 40 });
  });
});

describe("createImageObject", () => {
  it("sizes the image to a share of the page width and keeps its aspect ratio", () => {
    const img = createImageObject("i", { x: 10, y: 10 }, turned, {
      id: "asset",
      pixelWidth: 200,
      pixelHeight: 100,
    });
    expect(img.width).toBeCloseTo(400 * IMAGE_WIDTH_SHARE);
    expect(img.height).toBeCloseTo(200 * IMAGE_WIDTH_SHARE);
    expect(img.imageId).toBe("asset");
    expect(originOnScreen(img, turned)).toEqual({ x: 10, y: 10 });
  });

  it("falls back to a square for an image without a size", () => {
    const img = createImageObject("i", { x: 0, y: 0 }, flat, {
      id: "a",
      pixelWidth: 0,
      pixelHeight: 0,
    });
    expect(img.height).toBe(img.width);
  });
});

describe("startInk and updateGesture", () => {
  it("records points in the stroke's local space", () => {
    let g = startInk({ x: 100, y: 100 }, flat);
    g = updateGesture(g, { x: 110, y: 105 }, flat);
    if (g.kind !== "draw-ink") throw new Error("unreachable");
    expect(g.points.map(round)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("keeps local points upright on a rotated page", () => {
    let g = startInk({ x: 100, y: 100 }, turned);
    g = updateGesture(g, { x: 110, y: 100 }, turned); // 10 to the right on screen
    if (g.kind !== "draw-ink") throw new Error("unreachable");
    expect(round(g.points[1])).toEqual({ x: 10, y: 0 });
  });

  it("skips points that are too close together", () => {
    const g = startInk({ x: 100, y: 100 }, flat);
    expect(updateGesture(g, { x: 100.3, y: 100 }, flat)).toBe(g);
  });

  it("tracks the pointer for other gestures", () => {
    const g: Gesture = {
      kind: "draw-box",
      tool: "rect",
      start: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
    };
    expect(updateGesture(g, { x: 5, y: 6 }, flat)).toMatchObject({
      current: { x: 5, y: 6 },
    });
  });
});

describe("boxFromDrag", () => {
  it("normalises a drag made in any direction", () => {
    const b = boxFromDrag(
      "b",
      "rect",
      { x: 50, y: 80 },
      { x: 10, y: 20 },
      flat,
      style,
    );
    expect(b).toMatchObject({
      kind: "rect",
      width: 40,
      height: 60,
      strokeWidth: style.strokeWidth,
    });
    expect(originOnScreen(b, flat)).toEqual({ x: 10, y: 20 });
  });

  it("uses the default size for a click", () => {
    const b = boxFromDrag(
      "b",
      "whiteout",
      { x: 5, y: 5 },
      { x: 5 + CLICK_TOLERANCE - 1, y: 5 },
      flat,
      style,
    );
    expect(b).toMatchObject({ kind: "whiteout", ...DEFAULT_BOX_SIZE.whiteout });
  });

  it("colours highlights with the highlight colour", () => {
    const b = boxFromDrag(
      "b",
      "highlight",
      { x: 0, y: 0 },
      { x: 30, y: 10 },
      flat,
      style,
    );
    expect(b).toMatchObject({ kind: "highlight", color: style.highlightColor });
  });
});

describe("moveBy", () => {
  it("converts a screen drag into user-space movement", () => {
    // y is flipped: dragging down lowers the user-space y
    expect(moveBy({ x: 10, y: 10 }, { x: 5, y: 5 }, flat)).toEqual({
      x: 15,
      y: 5,
    });
    // turned page: screen-right is user-up, screen-down is user-right
    expect(round(moveBy({ x: 10, y: 10 }, { x: 5, y: 3 }, turned))).toEqual({
      x: 13,
      y: 15,
    });
  });
});

describe("resizeBy", () => {
  const rect: RectObject = {
    id: "r",
    kind: "rect",
    x: 0,
    y: 400,
    rotation: 0,
    width: 50,
    height: 20,
    color: style.color,
    strokeWidth: 1,
  };

  it("grows along the box's own axes", () => {
    expect(resizeBy(rect, { x: 10, y: 5 }, flat)).toEqual({
      width: 60,
      height: 25,
    });
    // the same unrotated box on a turned page: screen-down is the box's right
    const r = resizeBy(rect, { x: 0, y: 10 }, turned);
    expect(round({ x: r.width, y: r.height })).toEqual({ x: 60, y: 20 });
  });

  it("never shrinks below the minimum", () => {
    expect(resizeBy(rect, { x: -500, y: -500 }, flat)).toEqual({
      width: MIN_OBJECT_SIZE,
      height: MIN_OBJECT_SIZE,
    });
  });

  it("keeps an image's aspect ratio", () => {
    const img: ImageObject = {
      ...rect,
      kind: "image",
      imageId: "a",
      width: 40,
      height: 20,
    };
    expect(resizeBy(img, { x: 40, y: 0 }, flat)).toEqual({
      width: 80,
      height: 40,
    });
  });
});

describe("previewObject and finishGesture", () => {
  it("turns a stroke into an ink object", () => {
    const g = updateGesture(
      startInk({ x: 0, y: 0 }, flat),
      { x: 4, y: 0 },
      flat,
    );
    const out = finishGesture(g, flat, style, "ink1");
    expect(out?.type).toBe("add");
    if (out?.type !== "add") throw new Error("unreachable");
    expect(out.object).toMatchObject({
      id: "ink1",
      kind: "ink",
      color: style.color,
    });
  });

  it("turns a box drag into a new box", () => {
    const g: Gesture = {
      kind: "draw-box",
      tool: "highlight",
      start: { x: 0, y: 0 },
      current: { x: 50, y: 10 },
    };
    expect(finishGesture(g, flat, style, "h1")).toMatchObject({
      type: "add",
      object: { id: "h1", kind: "highlight", width: 50, height: 10 },
    });
  });

  it("turns a move into a position update, and a click into nothing", () => {
    const object = createTextObject("t", { x: 0, y: 0 }, flat, style);
    const move: Gesture = {
      kind: "move",
      object,
      start: { x: 0, y: 0 },
      current: { x: 10, y: 0 },
    };
    expect(previewObject(move, flat, style, "x").x).toBeCloseTo(object.x + 10);
    expect(finishGesture(move, flat, style, "x")).toEqual({
      type: "update",
      objectId: "t",
      patch: { x: object.x + 10, y: object.y },
    });
    expect(
      finishGesture({ ...move, current: { x: 0.2, y: 0 } }, flat, style, "x"),
    ).toBeNull();
  });

  it("turns a resize into a size update", () => {
    const object = boxFromDrag(
      "r",
      "rect",
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      flat,
      style,
    );
    const g: Gesture = {
      kind: "resize",
      object,
      start: { x: 20, y: 20 },
      current: { x: 30, y: 25 },
    };
    expect(finishGesture(g, flat, style, "x")).toEqual({
      type: "update",
      objectId: "r",
      patch: { width: 30, height: 25 },
    });
  });
});
