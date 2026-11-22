import { describe, expect, it } from "vitest";
import {
  RESIZE_HANDLES,
  clamp,
  cursorFor,
  dragRect,
  handlePosition,
} from "./drag";

const page = { width: 600, height: 800 };
const start = { x: 100, y: 100, width: 200, height: 300 };

describe("dragRect", () => {
  it("moves the rectangle and stops it at the page edges", () => {
    expect(dragRect(start, "move", { x: 50, y: -20 }, page)).toEqual({
      ...start,
      x: 150,
      y: 80,
    });
    expect(dragRect(start, "move", { x: -500, y: 900 }, page)).toEqual({
      ...start,
      x: 0,
      y: 500,
    });
  });

  it("moves only the grabbed edges", () => {
    expect(dragRect(start, "e", { x: 40, y: 99 }, page)).toEqual({
      ...start,
      width: 240,
    });
    expect(dragRect(start, "nw", { x: -50, y: -30 }, page)).toEqual({
      x: 50,
      y: 70,
      width: 250,
      height: 330,
    });
    expect(dragRect(start, "s", { x: 0, y: 10 }, page)).toEqual({
      ...start,
      height: 310,
    });
  });

  it("never leaves the page or shrinks below the minimum", () => {
    expect(dragRect(start, "w", { x: -900, y: 0 }, page).x).toBe(0);
    expect(dragRect(start, "se", { x: 900, y: 900 }, page)).toEqual({
      ...start,
      width: 500,
      height: 700,
    });
    // Dragging the left edge past the right one stops minSize short of it.
    expect(dragRect(start, "w", { x: 500, y: 0 }, page, 20)).toEqual({
      ...start,
      x: 280,
      width: 20,
    });
    expect(dragRect(start, "n", { x: 0, y: 500 }, page, 20)).toEqual({
      ...start,
      y: 380,
      height: 20,
    });
  });
});

describe("cursorFor", () => {
  it.each([
    ["move", "move"],
    ["n", "ns-resize"],
    ["s", "ns-resize"],
    ["e", "ew-resize"],
    ["w", "ew-resize"],
    ["ne", "nesw-resize"],
    ["sw", "nesw-resize"],
    ["nw", "nwse-resize"],
    ["se", "nwse-resize"],
  ] as const)("%s -> %s", (handle, cursor) => {
    expect(cursorFor(handle)).toBe(cursor);
  });
});

describe("handlePosition", () => {
  it("puts corners on corners and edge handles mid-edge", () => {
    expect(handlePosition(start, "nw")).toEqual({ x: 100, y: 100 });
    expect(handlePosition(start, "n")).toEqual({ x: 200, y: 100 });
    expect(handlePosition(start, "se")).toEqual({ x: 300, y: 400 });
    expect(handlePosition(start, "w")).toEqual({ x: 100, y: 250 });
  });

  it("covers every resize handle", () => {
    expect(new Set(RESIZE_HANDLES).size).toBe(8);
  });
});

describe("clamp", () => {
  it("limits to the range, preferring the minimum when it is empty", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 8, 2)).toBe(8);
  });
});
