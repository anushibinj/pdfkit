import { describe, expect, it } from "vitest";
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, pageImageSize } from "./render-size";

const A4 = { width: 595.28, height: 841.89 };

describe("pageImageSize", () => {
  it("converts points to pixels at the requested DPI", () => {
    expect(pageImageSize({ width: 612, height: 792 }, 72)).toEqual({
      width: 612,
      height: 792,
      dpi: 72,
      reduced: false,
    });
    expect(pageImageSize(A4, 150)).toEqual({
      width: 1240,
      height: 1754,
      dpi: 150,
      reduced: false,
    });
  });

  it("keeps an A4 page at 300 DPI within the limits", () => {
    const size = pageImageSize(A4, 300);
    expect(size).toMatchObject({ width: 2480, height: 3508, reduced: false });
  });

  it("shrinks a large page to the pixel limit, keeping its shape", () => {
    const size = pageImageSize(A4, 600);
    expect(size.reduced).toBe(true);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    expect(size.width / size.height).toBeCloseTo(A4.width / A4.height, 2);
    expect(size.dpi).toBeLessThan(600);
    expect(size.dpi).toBeGreaterThan(400);
  });

  it("shrinks a very long page to the side limit", () => {
    const size = pageImageSize({ width: 10, height: 200_000 }, 72);
    expect(size.reduced).toBe(true);
    expect(size.height).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
    expect(size.width).toBeGreaterThanOrEqual(1);
  });

  it("never returns less than one pixel", () => {
    expect(pageImageSize({ width: 0, height: 0 }, 150)).toMatchObject({
      width: 1,
      height: 1,
      reduced: false,
    });
    expect(pageImageSize({ width: 0.1, height: 0.1 }, 72)).toMatchObject({
      width: 1,
      height: 1,
    });
  });
});
