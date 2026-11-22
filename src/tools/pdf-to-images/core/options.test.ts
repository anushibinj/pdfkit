import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_OPTIONS,
  MAX_DPI,
  MIN_DPI,
  MIN_QUALITY,
  clampNumber,
  sanitizeRenderOptions,
} from "./options";

describe("clampNumber", () => {
  it("clamps finite numbers and falls back for anything else", () => {
    expect(clampNumber(5, 1, 10, 3)).toBe(5);
    expect(clampNumber(-5, 1, 10, 3)).toBe(1);
    expect(clampNumber(50, 1, 10, 3)).toBe(10);
    expect(clampNumber(Number.NaN, 1, 10, 3)).toBe(3);
    expect(clampNumber(Infinity, 1, 10, 3)).toBe(3);
    expect(clampNumber("7", 1, 10, 3)).toBe(3);
  });
});

describe("sanitizeRenderOptions", () => {
  it("keeps valid options", () => {
    const options = { format: "jpeg", dpi: 300, quality: 0.75 } as const;
    expect(sanitizeRenderOptions(options)).toEqual(options);
  });

  it("falls back to the defaults for missing or invalid input", () => {
    expect(sanitizeRenderOptions(undefined)).toEqual(DEFAULT_RENDER_OPTIONS);
    expect(sanitizeRenderOptions("x")).toEqual(DEFAULT_RENDER_OPTIONS);
    expect(
      sanitizeRenderOptions({ format: "gif", dpi: "300", quality: null }),
    ).toEqual(DEFAULT_RENDER_OPTIONS);
  });

  it("rounds and clamps the resolution and the quality", () => {
    expect(sanitizeRenderOptions({ dpi: 149.6 }).dpi).toBe(150);
    expect(sanitizeRenderOptions({ dpi: 1 }).dpi).toBe(MIN_DPI);
    expect(sanitizeRenderOptions({ dpi: 99_999 }).dpi).toBe(MAX_DPI);
    expect(sanitizeRenderOptions({ quality: 0 }).quality).toBe(MIN_QUALITY);
    expect(sanitizeRenderOptions({ quality: 3 }).quality).toBe(1);
  });
});
