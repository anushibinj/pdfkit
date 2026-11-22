import { describe, expect, it } from "vitest";
import { applyToPoint, applyToVector } from "@/lib/geometry/affine";
import type { PageBox, QuarterTurns } from "./model";
import {
  objectToUser,
  objectToView,
  uprightFrameAt,
  viewToObject,
} from "./object-frame";

const box: PageBox = { left: 100, bottom: 50, right: 700, top: 450 };
const close = (p: { x: number; y: number }) => ({
  x: Math.round(p.x * 1e6) / 1e6 + 0,
  y: Math.round(p.y * 1e6) / 1e6 + 0,
});

describe("objectToUser", () => {
  it("maps local right/down to user right/down for an unrotated object", () => {
    const m = objectToUser({ x: 10, y: 20, rotation: 0 });
    expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
    // 5 to the right and 3 down; user y points up, so y decreases
    expect(applyToPoint(m, { x: 5, y: 3 })).toEqual({ x: 15, y: 17 });
  });

  it.each([
    [1, { x: 0, y: 1 }, { x: 1, y: 0 }],
    [2, { x: -1, y: 0 }, { x: 0, y: 1 }],
    [3, { x: 0, y: -1 }, { x: -1, y: 0 }],
  ] as const)(
    "turns the axes counter-clockwise for rotation %d",
    (rotation, right, down) => {
      const m = objectToUser({ x: 0, y: 0, rotation });
      expect(close(applyToVector(m, { x: 1, y: 0 }))).toEqual(right);
      expect(close(applyToVector(m, { x: 0, y: 1 }))).toEqual(down);
    },
  );
});

describe("objectToView", () => {
  it.each([0, 1, 2, 3] as const)(
    "an object rotated like the page (%d) reads upright on screen",
    (turns) => {
      const m = objectToView({ x: 300, y: 200, rotation: turns }, box, turns);
      // pure translation: no rotation, no flip, no scale
      expect(close({ x: m[0], y: m[1] })).toEqual({ x: 1, y: 0 });
      expect(close({ x: m[2], y: m[3] })).toEqual({ x: 0, y: 1 });
    },
  );

  it("an unrotated object on a page turned clockwise is drawn turned clockwise", () => {
    const m = objectToView({ x: 300, y: 200, rotation: 0 }, box, 1);
    // local "right" now points down the screen
    expect(close(applyToVector(m, { x: 1, y: 0 }))).toEqual({ x: 0, y: 1 });
  });
});

describe("viewToObject", () => {
  it("inverts objectToView", () => {
    const frame = { x: 300, y: 200, rotation: 3 as QuarterTurns };
    const p = applyToPoint(
      viewToObject(frame, box, 2),
      applyToPoint(objectToView(frame, box, 2), { x: 12, y: 34 }),
    );
    expect(close(p)).toEqual({ x: 12, y: 34 });
  });
});

describe("uprightFrameAt", () => {
  it.each([0, 1, 2, 3] as const)(
    "places the local origin under the click on a page turned %d",
    (turns) => {
      const frame = uprightFrameAt({ x: 40, y: 60 }, box, turns);
      expect(frame.rotation).toBe(turns);
      const origin = applyToPoint(objectToView(frame, box, turns), {
        x: 0,
        y: 0,
      });
      expect(close(origin)).toEqual({ x: 40, y: 60 });
    },
  );
});
