import { describe, expect, it } from "vitest";
import type { CharWithBox } from "./model";
import { normalizeTokenText, tokenizePageChars } from "./text-tokens";

function makeChars(str: string): CharWithBox[] {
  return Array.from(str).map((char, idx) => ({
    char,
    generated: char === " " || char === "\n",
    box:
      char === " " || char === "\n"
        ? null
        : { left: idx * 6, bottom: 100, right: idx * 6 + 5, top: 112 },
  }));
}

describe("text-tokens", () => {
  it("normalises smart quotes and dashes", () => {
    expect(normalizeTokenText("“don’t”—test")).toBe('"don\'t"-test');
  });

  it("tokenizes words, numbers with decimals/commas, and separates trailing punctuation", () => {
    const { text, tokens } = tokenizePageChars(
      makeChars("Total: $1,250.50 due (net-30)."),
    );

    expect(tokens.map((t) => t.text)).toEqual([
      "Total",
      ":",
      "$",
      "1,250.50",
      "due",
      "(",
      "net-30",
      ")",
      ".",
    ]);
    expect(text).toBe("Total : $ 1,250.50 due ( net-30 ) .");
    expect(tokens[3].boxes).toHaveLength(8);
  });

  it("returns empty tokens for whitespace-only or empty pages", () => {
    expect(tokenizePageChars([])).toEqual({ text: "", tokens: [] });
    expect(tokenizePageChars(makeChars("   \n  "))).toEqual({
      text: "",
      tokens: [],
    });
  });

  it("preserves Unicode letters across non-ASCII scripts", () => {
    const { tokens } = tokenizePageChars(makeChars("Café résumé naïve"));
    expect(tokens.map((t) => t.text)).toEqual(["Café", "résumé", "naïve"]);
  });
});
