import { describe, expect, it } from "vitest";
import { applyToPoint } from "@/lib/affine";
import { viewSize } from "@/lib/pdfium/page-box";
import type { PageBox, QuarterTurns } from "./model";
import { addTurns, userToView, viewToUser } from "./page-geometry";

// A box that does not start at the origin, to catch offset mistakes.
const box: PageBox = { left: 100, bottom: 50, right: 700, top: 450 }; // 600 x 400

const view = (turns: QuarterTurns, x: number, y: number) => {
  const p = applyToPoint(userToView(box, turns), { x, y });
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
};

describe("addTurns", () => {
  it.each([
    [0, 1, 1],
    [3, 1, 0],
    [0, -1, 3],
    [1, -3, 2],
    [2, 6, 0],
  ])("%d + %d -> %d", (a, b, expected) => {
    expect(addTurns(a, b)).toBe(expected);
  });
});

describe("userToView", () => {
  // The box's top-left corner (as the unrotated page is read) is (100, 450).
  it("unrotated: top-left corner at the origin, y pointing down", () => {
    expect(view(0, 100, 450)).toEqual({ x: 0, y: 0 });
    expect(view(0, 700, 50)).toEqual({ x: 600, y: 400 });
    expect(view(0, 110, 440)).toEqual({ x: 10, y: 10 });
  });

  it("90 degrees clockwise: the old top-left corner moves to the top-right", () => {
    expect(view(1, 100, 450)).toEqual({ x: 400, y: 0 });
    expect(view(1, 700, 450)).toEqual({ x: 400, y: 600 });
    expect(view(1, 100, 50)).toEqual({ x: 0, y: 0 });
  });

  it("180 degrees: corners swap diagonally", () => {
    expect(view(2, 100, 450)).toEqual({ x: 600, y: 400 });
    expect(view(2, 700, 50)).toEqual({ x: 0, y: 0 });
  });

  it("270 degrees: the old top-left corner moves to the bottom-left", () => {
    expect(view(3, 100, 450)).toEqual({ x: 0, y: 600 });
    expect(view(3, 700, 450)).toEqual({ x: 0, y: 0 });
  });

  it("keeps every corner inside the displayed page", () => {
    for (const turns of [0, 1, 2, 3] as const) {
      const size = viewSize(box, turns);
      for (const [x, y] of [
        [100, 50],
        [700, 50],
        [100, 450],
        [700, 450],
      ]) {
        const p = view(turns, x, y);
        expect(p.x === 0 || p.x === size.width).toBe(true);
        expect(p.y === 0 || p.y === size.height).toBe(true);
      }
    }
  });
});

describe("viewToUser", () => {
  it("round-trips view points back to user space", () => {
    for (const turns of [0, 1, 2, 3] as const) {
      const p = applyToPoint(viewToUser(box, turns), view(turns, 321, 123));
      expect(p.x).toBeCloseTo(321);
      expect(p.y).toBeCloseTo(123);
    }
  });
});
