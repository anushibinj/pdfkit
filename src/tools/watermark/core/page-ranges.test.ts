import { describe, expect, it } from "vitest";
import { formatPageRanges, parsePageRanges } from "./page-ranges";

describe("parsePageRanges", () => {
  it("selects every page for empty text", () => {
    expect(parsePageRanges("  ", 3)).toEqual({ ok: true, pages: [0, 1, 2] });
  });

  it("parses pages, ranges and open ends, merging overlaps", () => {
    expect(parsePageRanges("1-3, 2, 5", 6)).toEqual({
      ok: true,
      pages: [0, 1, 2, 4],
    });
    expect(parsePageRanges("5-", 6)).toEqual({ ok: true, pages: [4, 5] });
    expect(parsePageRanges("-2", 6)).toEqual({ ok: true, pages: [0, 1] });
    expect(parsePageRanges(" 2 - 3 ", 6)).toEqual({ ok: true, pages: [1, 2] });
  });

  it("accepts en and em dashes and skips empty items", () => {
    expect(parsePageRanges("1–2,,4—5,", 6)).toEqual({
      ok: true,
      pages: [0, 1, 3, 4],
    });
  });

  it.each([
    ["abc", /not a page number/],
    ["1-2-3", /not a page number/],
    ["-", /at least one side/],
    [",", /Enter page numbers/],
    ["0", /start at 1/],
    ["7", /There is no page 7: this PDF has 6 pages/],
    ["2-9", /There is no page 9/],
    ["5-3", /goes backwards. Write it as 3-5/],
  ])("rejects %j", (input, error) => {
    const result = parsePageRanges(input, 6);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(error);
  });

  it("says page, not pages, for a one-page PDF", () => {
    expect(parsePageRanges("2", 1)).toEqual({
      ok: false,
      error: "There is no page 2: this PDF has 1 page.",
    });
  });
});

describe("formatPageRanges", () => {
  it("compresses ascending runs into 1-based ranges", () => {
    expect(formatPageRanges([0, 1, 2, 4, 6, 7])).toBe("1-3,5,7-8");
  });

  it("keeps the order and repeats (for qpdf's --from)", () => {
    expect(formatPageRanges([0, 0, 1, 0])).toBe("1,1-2,1");
    expect(formatPageRanges([0, 1, 2, 4, 4])).toBe("1-3,5,5");
  });

  it("returns an empty string for no pages", () => {
    expect(formatPageRanges([])).toBe("");
  });
});
