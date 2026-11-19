import { describe, expect, it } from "vitest";
import {
  MAX_VIEW_RENDER_WIDTH,
  MIN_VIEW_RENDER_WIDTH,
  RENDER_WIDTH_STEP,
  renderWidthFor,
} from "./render-width";

describe("renderWidthFor", () => {
  it("matches device pixels, rounded up to the step", () => {
    expect(renderWidthFor(800, 1)).toBe(4 * RENDER_WIDTH_STEP); // 1024
    expect(renderWidthFor(800, 2)).toBe(7 * RENDER_WIDTH_STEP); // 1792
  });

  it("does not change for small layout shifts", () => {
    expect(renderWidthFor(790, 1)).toBe(renderWidthFor(800, 1));
  });

  it("clamps to the allowed range and survives junk ratios", () => {
    expect(renderWidthFor(0, 1)).toBe(MIN_VIEW_RENDER_WIDTH);
    expect(renderWidthFor(5000, 3)).toBe(MAX_VIEW_RENDER_WIDTH);
    expect(renderWidthFor(800, Number.NaN)).toBe(renderWidthFor(800, 1));
    expect(renderWidthFor(800, 0)).toBe(renderWidthFor(800, 1));
  });
});
