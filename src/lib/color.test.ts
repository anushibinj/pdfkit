import { describe, expect, it } from "vitest";
import { clampChannel, hexToRgb, rgbToHex } from "./color";

describe("hexToRgb", () => {
  it("parses #rrggbb in any letter case", () => {
    expect(hexToRgb("#1D4ed8")).toEqual({ r: 29, g: 78, b: 216 });
    expect(hexToRgb(" #000000 ")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it.each(["", "#fff", "1d4ed8", "#gggggg", "#1d4ed8ff"])("rejects %j", (s) => {
    expect(hexToRgb(s)).toBeNull();
  });
});

describe("rgbToHex", () => {
  it("formats lowercase and pads each channel", () => {
    expect(rgbToHex({ r: 29, g: 78, b: 216 })).toBe("#1d4ed8");
    expect(rgbToHex({ r: 0, g: 5, b: 255 })).toBe("#0005ff");
  });

  it("clamps out-of-range channels", () => {
    expect(rgbToHex({ r: -3, g: 300, b: 127.6 })).toBe("#00ff80");
  });
});

describe("clampChannel", () => {
  it.each([
    [12.4, 12],
    [-1, 0],
    [999, 255],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])("%d -> %d", (input, expected) => {
    expect(clampChannel(input)).toBe(expected);
  });
});
