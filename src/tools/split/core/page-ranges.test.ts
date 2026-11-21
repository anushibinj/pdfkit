import { describe, expect, it } from "vitest";
import {
  expandPageRuns,
  formatPageRuns,
  parsePageRanges,
  toPageRuns,
} from "./page-ranges";

describe("parsePageRanges", () => {
  it.each([
    ["5", [{ first: 4, last: 4 }]],
    ["1-3", [{ first: 0, last: 2 }]],
    ["8-", [{ first: 7, last: 9 }]],
    ["-3", [{ first: 0, last: 2 }]],
    [" 1 - 3 , 5 ", [{ first: 0, last: 2 }, { first: 4, last: 4 }]],
    ["1–3", [{ first: 0, last: 2 }]],
    ["1—3", [{ first: 0, last: 2 }]],
    ["007", [{ first: 6, last: 6 }]],
    ["3-3", [{ first: 2, last: 2 }]],
    ["10", [{ first: 9, last: 9 }]],
  ])("reads %j (10 pages)", (text, runs) => {
    expect(parsePageRanges(text, 10)).toEqual({ ok: true, runs });
  });

  it("keeps the typed order, overlaps and repeats", () => {
    expect(parsePageRanges("4-6, 1-5, 4-6", 10)).toEqual({
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
      const result = parsePageRanges(text, 10);
      expect(result.ok).toBe(true);
    },
  );

  it.each([
    ["abc", /not a page number or a range/],
    ["1.5", /not a page number or a range/],
    ["1 2", /needs a comma or a dash/],
    ["-", /needs a page number before or after the dash/],
    ["0", /pages start at 1/],
    ["0-2", /pages start at 1/],
    ["11", /only 10 pages/],
    ["2-11", /only 10 pages/],
    ["5-3", /goes backwards\. Write it as 3-5/],
    ["1-2-3", /not a page number or a range/],
  ])("explains what is wrong with %j", (text, message) => {
    const result = parsePageRanges(text, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it("reports the first bad item and says 'only 1 page' for one-page files", () => {
    expect(parsePageRanges("1, 2, x", 1)).toEqual({
      ok: false,
      error: '"2": this PDF has only 1 page.',
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

  it("writes 1-based numbers for people", () => {
    expect(formatPageRuns(runs)).toBe("1-3, 5");
  });

  it("uses the given separator (qpdf's --pages wants plain commas)", () => {
    expect(formatPageRuns(runs, ",")).toBe("1-3,5");
  });

  it("round-trips with parsePageRanges", () => {
    const text = formatPageRuns(runs);
    expect(parsePageRanges(text, 9)).toEqual({ ok: true, runs });
  });

  it("is empty for no runs", () => {
    expect(formatPageRuns([])).toBe("");
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
