import { describe, expect, it } from "vitest";
import {
  expandPageRuns,
  formatPageRanges,
  formatPageRuns,
  parsePageRuns,
  parsePageSelection,
  toPageRuns,
} from "./page-ranges";

describe("parsePageRuns", () => {
  it.each([
    ["5", [{ first: 4, last: 4 }]],
    ["1-3", [{ first: 0, last: 2 }]],
    ["8-", [{ first: 7, last: 9 }]],
    ["-3", [{ first: 0, last: 2 }]],
    [
      " 1 - 3 , 5 ",
      [
        { first: 0, last: 2 },
        { first: 4, last: 4 },
      ],
    ],
    ["1–3", [{ first: 0, last: 2 }]],
    ["1—3", [{ first: 0, last: 2 }]],
    ["007", [{ first: 6, last: 6 }]],
    ["3-3", [{ first: 2, last: 2 }]],
  ])("reads %j (10 pages)", (text, runs) => {
    expect(parsePageRuns(text, 10)).toEqual({ ok: true, runs });
  });

  it("keeps items as typed: in order, overlapping and repeated", () => {
    expect(parsePageRuns("4-6, 1-5, 4-6", 10)).toEqual({
      ok: true,
      runs: [
        { first: 3, last: 5 },
        { first: 0, last: 4 },
        { first: 3, last: 5 },
      ],
    });
  });

  it.each(["", "   ", ",", "1-3,", ", ,2"])(
    "skips empty items in %j",
    (text) => {
      expect(parsePageRuns(text, 10).ok).toBe(true);
    },
  );

  it("gives no runs for blank text", () => {
    expect(parsePageRuns(" , ", 10)).toEqual({ ok: true, runs: [] });
  });

  it.each([
    ["abc", "“abc” is not a page number or a range such as 2-5."],
    ["1.5", "“1.5” is not a page number or a range such as 2-5."],
    ["1 2", "“1 2” is not a page number or a range such as 2-5."],
    ["1-2-3", "“1-2-3” is not a page number or a range such as 2-5."],
    ["-", "“-” needs a page number on at least one side."],
    ["0", "Page numbers start at 1."],
    ["0-2", "Page numbers start at 1."],
    ["11", "There is no page 11: this PDF has 10 pages."],
    ["2-11", "There is no page 11: this PDF has 10 pages."],
    ["5-3", "“5-3” goes backwards. Write it as 3-5."],
  ])("explains what is wrong with %j", (text, error) => {
    expect(parsePageRuns(text, 10)).toEqual({ ok: false, error });
  });

  it("reports the first bad item, with 'page' for one-page files", () => {
    expect(parsePageRuns("1, 2, x", 1)).toEqual({
      ok: false,
      error: "There is no page 2: this PDF has 1 page.",
    });
  });
});

describe("toPageRuns", () => {
  it("joins consecutive pages and keeps order", () => {
    expect(toPageRuns([0, 1, 2, 4, 6, 7])).toEqual([
      { first: 0, last: 2 },
      { first: 4, last: 4 },
      { first: 6, last: 7 },
    ]);
  });

  it("never makes a backwards run", () => {
    expect(toPageRuns([2, 1, 0])).toEqual([
      { first: 2, last: 2 },
      { first: 1, last: 1 },
      { first: 0, last: 0 },
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(toPageRuns([])).toEqual([]);
  });
});

describe("formatPageRuns", () => {
  const runs = [
    { first: 0, last: 2 },
    { first: 4, last: 4 },
  ];

  it("writes 1-based numbers, plain commas by default (qpdf)", () => {
    expect(formatPageRuns(runs)).toBe("1-3,5");
  });

  it("uses the given separator for people", () => {
    expect(formatPageRuns(runs, ", ")).toBe("1-3, 5");
  });

  it("round-trips with parsePageRuns", () => {
    expect(parsePageRuns(formatPageRuns(runs, ", "), 9)).toEqual({
      ok: true,
      runs,
    });
  });

  it("is empty for no runs", () => {
    expect(formatPageRuns([])).toBe("");
  });
});

describe("formatPageRanges", () => {
  it("groups indices into ranges, keeping order and repeats", () => {
    expect(formatPageRanges([0, 1, 2, 4, 4])).toBe("1-3,5,5");
    expect(formatPageRanges([0, 2, 3], ", ")).toBe("1, 3-4");
  });
});

describe("expandPageRuns", () => {
  it("lists every page in order, keeping repeats", () => {
    expect(
      expandPageRuns([
        { first: 2, last: 4 },
        { first: 3, last: 3 },
      ]),
    ).toEqual([2, 3, 4, 3]);
  });
});

describe("parsePageSelection", () => {
  it("selects every page for empty text", () => {
    expect(parsePageSelection("  ", 3)).toEqual({ ok: true, pages: [0, 1, 2] });
  });

  it("parses pages, ranges and open ends, merging overlaps", () => {
    expect(parsePageSelection("1-3, 2, 5", 6)).toEqual({
      ok: true,
      pages: [0, 1, 2, 4],
    });
    expect(parsePageSelection("5-", 6)).toEqual({ ok: true, pages: [4, 5] });
    expect(parsePageSelection("-2", 6)).toEqual({ ok: true, pages: [0, 1] });
    expect(parsePageSelection(" 2 - 3 ", 6)).toEqual({
      ok: true,
      pages: [1, 2],
    });
  });

  it("accepts en and em dashes and skips empty items", () => {
    expect(parsePageSelection("1–2,,4—5,", 6)).toEqual({
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
    const result = parsePageSelection(input, 6);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(error);
  });

  it("says page, not pages, for a one-page PDF", () => {
    expect(parsePageSelection("2", 1)).toEqual({
      ok: false,
      error: "There is no page 2: this PDF has 1 page.",
    });
  });
});
