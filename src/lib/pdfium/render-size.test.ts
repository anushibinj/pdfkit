import { describe, expect, it } from "vitest";
import {
  MAX_RENDER_PIXELS,
  MAX_RENDER_WIDTH,
  fitRenderSize,
} from "./render-size";

describe("fitRenderSize", () => {
  it("follows the page's aspect ratio", () => {
    expect(fitRenderSize({ width: 600, height: 400 }, 900)).toEqual({
      width: 900,
      height: 600,
    });
  });

  it("clamps the width and survives junk input", () => {
    expect(fitRenderSize({ width: 200, height: 100 }, 99_999)).toEqual({
      width: MAX_RENDER_WIDTH,
      height: MAX_RENDER_WIDTH / 2,
    });
    expect(fitRenderSize({ width: 100, height: 100 }, Number.NaN)).toEqual({
      width: 1,
      height: 1,
    });
    expect(fitRenderSize({ width: 0, height: 100 }, 10)).toEqual({
      width: 10,
      height: 10,
    });
  });

  it("shrinks very tall pages under the pixel budget, keeping the shape", () => {
    const size = fitRenderSize({ width: 100, height: 10_000 }, 1000);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    expect(size.height / size.width).toBeCloseTo(100, 0);
  });
});
