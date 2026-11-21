import { describe, expect, it } from "vitest";
import {
  normalizeWatermarkText,
  standardFontName,
  textLines,
  unsupportedCharacters,
} from "./text";

describe("standardFontName", () => {
  it.each([
    ["helvetica", false, "Helvetica"],
    ["helvetica", true, "Helvetica-Bold"],
    ["times", false, "Times-Roman"],
    ["times", true, "Times-Bold"],
    ["courier", false, "Courier"],
    ["courier", true, "Courier-Bold"],
  ] as const)("%s bold=%s -> %s", (font, bold, name) => {
    expect(standardFontName(font, bold)).toBe(name);
  });
});

describe("normalizeWatermarkText", () => {
  it("unifies line breaks and replaces tabs", () => {
    expect(normalizeWatermarkText("a\r\nb\rc\td")).toBe("a\nb\nc d");
  });

  it("drops trailing spaces and outer blank lines but keeps inner ones", () => {
    expect(normalizeWatermarkText("\n\n  DRAFT  \n\nv2 \n\n")).toBe(
      "  DRAFT\n\nv2",
    );
  });

  it("returns an empty string when nothing visible is left", () => {
    expect(normalizeWatermarkText(" \n\t\n ")).toBe("");
  });
});

describe("textLines", () => {
  it("splits on newlines and has no lines for empty text", () => {
    expect(textLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(textLines("")).toEqual([]);
  });
});

describe("unsupportedCharacters", () => {
  it("accepts ASCII, Latin-1 and WinAnsi extras", () => {
    expect(unsupportedCharacters("Café — “Ñandú” €5\nsecond line")).toEqual([]);
  });

  it("lists each unsupported character once, in order", () => {
    expect(unsupportedCharacters("₹ नमस्ते ₹ Ω")).toEqual([
      "₹",
      "न",
      "म",
      "स",
      "्",
      "त",
      "े",
      "Ω",
    ]);
  });

  it("treats an emoji as one character, not two halves", () => {
    expect(unsupportedCharacters("ok 👍")).toEqual(["👍"]);
  });
});
