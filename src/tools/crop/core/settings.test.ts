import { describe, expect, it } from "vitest";
import { NO_MARGINS } from "./margins";
import { DEFAULT_SETTINGS, hasMargins, selectedPages } from "./settings";

describe("DEFAULT_SETTINGS", () => {
  it("starts with every page, no margins, removing what is outside", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      margins: NO_MARGINS,
      pages: "all",
      range: "",
      removeOutside: true,
    });
  });
});

describe("selectedPages", () => {
  it("lists every page, or the range's pages", () => {
    expect(selectedPages(DEFAULT_SETTINGS, 3)).toEqual({
      ok: true,
      pages: [0, 1, 2],
    });
    expect(
      selectedPages({ ...DEFAULT_SETTINGS, pages: "range", range: "2" }, 3),
    ).toEqual({ ok: true, pages: [1] });
    expect(
      selectedPages({ ...DEFAULT_SETTINGS, pages: "range", range: "9" }, 3).ok,
    ).toBe(false);
  });
});

describe("hasMargins", () => {
  it("is true when any edge is cut", () => {
    expect(hasMargins(NO_MARGINS)).toBe(false);
    expect(hasMargins({ ...NO_MARGINS, bottom: 0.5 })).toBe(true);
  });
});
