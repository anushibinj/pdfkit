import { describe, expect, it } from "vitest";
import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX,
  DRAG_THRESHOLD,
  autoScrollSpeed,
  columnCount,
  gapAtPointer,
  passedThreshold,
} from "./drag";

describe("passedThreshold", () => {
  it("is false for a shaky click and true for a real drag", () => {
    expect(passedThreshold(2, 2)).toBe(false);
    expect(passedThreshold(DRAG_THRESHOLD, 0)).toBe(true);
    expect(passedThreshold(-5, -5)).toBe(true);
  });
});

describe("gapAtPointer", () => {
  const rect = { left: 100, width: 50 };

  it("means 'before' on the left half and 'after' on the right half", () => {
    expect(gapAtPointer(3, rect, 110)).toBe(3);
    expect(gapAtPointer(3, rect, 124.9)).toBe(3);
    expect(gapAtPointer(3, rect, 125)).toBe(4);
    expect(gapAtPointer(3, rect, 149)).toBe(4);
  });
});

describe("autoScrollSpeed", () => {
  it("is zero away from the edges", () => {
    expect(autoScrollSpeed(400, 800)).toBe(0);
  });

  it("scrolls up near the top, faster closer to the edge", () => {
    const slow = autoScrollSpeed(AUTO_SCROLL_EDGE - 10, 800);
    const fast = autoScrollSpeed(0, 800);
    expect(slow).toBeLessThan(0);
    expect(fast).toBe(-AUTO_SCROLL_MAX);
    expect(fast).toBeLessThan(slow);
    expect(autoScrollSpeed(-50, 800)).toBe(-AUTO_SCROLL_MAX);
  });

  it("scrolls down near the bottom, capped at the maximum", () => {
    expect(autoScrollSpeed(790, 800)).toBeGreaterThan(0);
    expect(autoScrollSpeed(800, 800)).toBe(AUTO_SCROLL_MAX);
    expect(autoScrollSpeed(900, 800)).toBe(AUTO_SCROLL_MAX);
  });

  it("shrinks the bands on short screens and never divides by zero", () => {
    expect(autoScrollSpeed(50, 200)).toBe(0); // band is only 50 px
    expect(autoScrollSpeed(0, 0)).toBe(0);
  });
});

describe("columnCount", () => {
  it("counts the items on the first row", () => {
    expect(columnCount([10, 10, 10, 200, 200, 200, 390])).toBe(3);
    expect(columnCount([10.2, 10.6, 300])).toBe(2);
  });

  it("is 1 for a single column or an empty grid", () => {
    expect(columnCount([0, 100, 200])).toBe(1);
    expect(columnCount([])).toBe(1);
  });
});
