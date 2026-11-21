import { describe, expect, it } from "vitest";
import { boxSize, isQuarterTurns, viewSize, type PageBox } from "./page-box";

// A box that does not start at the origin, to catch offset mistakes.
const box: PageBox = { left: 100, bottom: 50, right: 700, top: 450 }; // 600 x 400

describe("isQuarterTurns", () => {
  it.each([0, 1, 2, 3])("accepts %d", (n) => {
    expect(isQuarterTurns(n)).toBe(true);
  });
  it.each([4, -1, 1.5, "1", null, undefined])("rejects %j", (v) => {
    expect(isQuarterTurns(v)).toBe(false);
  });
});

describe("boxSize and viewSize", () => {
  it("measures the box and swaps the sides for odd turns", () => {
    expect(boxSize(box)).toEqual({ width: 600, height: 400 });
    expect(viewSize(box, 0)).toEqual({ width: 600, height: 400 });
    expect(viewSize(box, 1)).toEqual({ width: 400, height: 600 });
    expect(viewSize(box, 2)).toEqual({ width: 600, height: 400 });
    expect(viewSize(box, 3)).toEqual({ width: 400, height: 600 });
  });
});
