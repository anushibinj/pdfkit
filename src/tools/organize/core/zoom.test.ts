import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  THUMBNAIL_RENDER_LIMITS,
  ZOOM_LEVELS,
  stepZoom,
} from "./zoom";

describe("stepZoom", () => {
  it("steps within the levels", () => {
    expect(stepZoom(DEFAULT_ZOOM, 1)).toBe(DEFAULT_ZOOM + 1);
    expect(stepZoom(0, -1)).toBe(0);
    expect(stepZoom(ZOOM_LEVELS.length - 1, 1)).toBe(ZOOM_LEVELS.length - 1);
    expect(stepZoom(Number.NaN, 1)).toBe(0);
  });

  it("keeps thumbnails smaller than full pages", () => {
    expect(THUMBNAIL_RENDER_LIMITS.max).toBeLessThan(1024);
    expect(THUMBNAIL_RENDER_LIMITS.min).toBeGreaterThan(0);
  });
});
