import { describe, expect, it } from "vitest";
import { SOURCE_COLORS, sourceColor } from "./source-colors";

describe("sourceColor", () => {
  it("gives each palette slot its colour and wraps around", () => {
    expect(sourceColor(0)).toBe(SOURCE_COLORS[0]);
    expect(sourceColor(2)).toBe(SOURCE_COLORS[2]);
    expect(sourceColor(SOURCE_COLORS.length + 1)).toBe(SOURCE_COLORS[1]);
  });

  it("falls back to the first colour for junk input", () => {
    expect(sourceColor(-1)).toBe(SOURCE_COLORS[0]);
    expect(sourceColor(1.5)).toBe(SOURCE_COLORS[0]);
    expect(sourceColor(Number.NaN)).toBe(SOURCE_COLORS[0]);
  });

  it("has distinct colours", () => {
    expect(new Set(SOURCE_COLORS.map((c) => c.fill)).size).toBe(
      SOURCE_COLORS.length,
    );
  });
});
