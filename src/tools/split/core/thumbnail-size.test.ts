import { describe, expect, it } from "vitest";
import {
  FALLBACK_PAGE_SIZE,
  MAX_THUMBNAIL_PIXELS,
  MAX_THUMBNAIL_WIDTH,
  thumbnailSize,
  usablePageSize,
} from "./thumbnail-size";

describe("usablePageSize", () => {
  it("keeps a real size", () => {
    expect(usablePageSize(595, 842)).toEqual({ width: 595, height: 842 });
  });

  it.each([
    [0, 842],
    [595, -1],
    [Number.NaN, 842],
    [595, Number.POSITIVE_INFINITY],
  ])("falls back to Letter for %d x %d", (w, h) => {
    expect(usablePageSize(w, h)).toEqual(FALLBACK_PAGE_SIZE);
  });

  it("returns a copy of the fallback, not the shared object", () => {
    expect(usablePageSize(0, 0)).not.toBe(FALLBACK_PAGE_SIZE);
  });
});

describe("thumbnailSize", () => {
  const a4 = { width: 595, height: 842 };

  it("follows the page's shape", () => {
    expect(thumbnailSize(a4, 200)).toEqual({ width: 200, height: 283 });
    expect(thumbnailSize({ width: 842, height: 595 }, 200)).toEqual({
      width: 200,
      height: 141,
    });
  });

  it.each([
    [0, 1],
    [-50, 1],
    [Number.NaN, 1],
    [10_000, MAX_THUMBNAIL_WIDTH],
    [199.6, 200],
  ])("clamps a requested width of %d to %d", (requested, width) => {
    expect(thumbnailSize(a4, requested).width).toBe(width);
  });

  it("shrinks very tall pages to the pixel budget, keeping the shape", () => {
    const strip = { width: 100, height: 100_000 };
    const size = thumbnailSize(strip, 500);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_THUMBNAIL_PIXELS);
    expect(size.height / size.width).toBeCloseTo(1000, -1);
  });

  it("never returns a zero side", () => {
    expect(thumbnailSize({ width: 100_000, height: 1 }, 10)).toEqual({
      width: 10,
      height: 1,
    });
  });
});
