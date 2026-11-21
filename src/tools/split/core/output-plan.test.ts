import { describe, expect, it } from "vitest";
import {
  PLANNERS,
  planEvery,
  planExtract,
  planOutputs,
  planRanges,
  planRemove,
  type PlanSettings,
} from "./output-plan";
import { EMPTY_SELECTION, type PageSelection } from "./page-selection";

const pick = (...pages: number[]): PageSelection => ({
  ...EMPTY_SELECTION,
  pages: new Set(pages),
});

const pagesOf = (result: ReturnType<typeof planEvery>) =>
  result.ok ? result.outputs.map((o) => o.pages) : result.error;

describe("planEvery", () => {
  it("cuts into equal chunks and gives the rest to the last file", () => {
    expect(pagesOf(planEvery(7, 3))).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it("makes one file per page with 1", () => {
    expect(pagesOf(planEvery(3, 1))).toEqual([[0], [1], [2]]);
  });

  it("works when the size divides the page count", () => {
    expect(pagesOf(planEvery(4, 2))).toEqual([[0, 1], [2, 3]]);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects %d pages per file", (size) => {
    expect(planEvery(10, size)).toEqual({
      ok: false,
      error: expect.stringMatching(/whole number/),
    });
  });

  it("rejects a size that would not split anything", () => {
    expect(planEvery(5, 5)).toEqual({
      ok: false,
      error: expect.stringMatching(/all 5 pages\. Enter a number below 5/),
    });
    expect(planEvery(5, 9).ok).toBe(false);
  });

  it("refuses to split a one-page PDF", () => {
    expect(planEvery(1, 1)).toEqual({
      ok: false,
      error: expect.stringMatching(/only one page/),
    });
  });
});

describe("planRanges", () => {
  it("makes one file per typed item, in typed order", () => {
    expect(pagesOf(planRanges("4-5, 1-2, 3", 5))).toEqual([[3, 4], [0, 1], [2]]);
  });

  it("allows overlapping and repeated ranges", () => {
    expect(pagesOf(planRanges("1-2, 2-3, 1-2", 3))).toEqual([
      [0, 1],
      [1, 2],
      [0, 1],
    ]);
  });

  it("passes parse errors through", () => {
    expect(planRanges("9", 3)).toEqual({
      ok: false,
      error: expect.stringMatching(/only 3 pages/),
    });
  });

  it("asks for at least one range", () => {
    expect(planRanges(" , ", 3)).toEqual({
      ok: false,
      error: expect.stringMatching(/at least one range/),
    });
  });
});

describe("planExtract", () => {
  it("makes one file with the picked pages in page order", () => {
    expect(pagesOf(planExtract(pick(4, 0, 2)))).toEqual([[0, 2, 4]]);
  });

  it("asks for a page, and passes a typing error through", () => {
    expect(planExtract(EMPTY_SELECTION)).toEqual({
      ok: false,
      error: "Pick at least one page to extract.",
    });
    expect(planExtract({ ...pick(1), error: "bad" })).toEqual({
      ok: false,
      error: "bad",
    });
  });
});

describe("planRemove", () => {
  it("keeps every page that was not picked", () => {
    expect(pagesOf(planRemove(pick(1, 3), 5))).toEqual([[0, 2, 4]]);
  });

  it("refuses to remove every page", () => {
    expect(planRemove(pick(0, 1), 2)).toEqual({
      ok: false,
      error: expect.stringMatching(/at least one page/),
    });
  });

  it("asks for a page, and passes a typing error through", () => {
    expect(planRemove(EMPTY_SELECTION, 3)).toEqual({
      ok: false,
      error: "Pick at least one page to remove.",
    });
    expect(planRemove({ ...pick(1), error: "bad" }, 3)).toEqual({
      ok: false,
      error: "bad",
    });
  });
});

describe("planOutputs", () => {
  const base: PlanSettings = {
    mode: "split",
    pageCount: 4,
    splitMethod: "every",
    everyN: 2,
    rangesText: "1, 2-4",
    selection: pick(0),
  };

  it("uses the strategy of the active mode", () => {
    expect(pagesOf(planOutputs(base))).toEqual([[0, 1], [2, 3]]);
    expect(pagesOf(planOutputs({ ...base, splitMethod: "ranges" }))).toEqual([
      [0],
      [1, 2, 3],
    ]);
    expect(pagesOf(planOutputs({ ...base, mode: "extract" }))).toEqual([[0]]);
    expect(pagesOf(planOutputs({ ...base, mode: "remove" }))).toEqual([
      [1, 2, 3],
    ]);
  });

  it("has a strategy for every mode", () => {
    expect(Object.keys(PLANNERS).sort()).toEqual(["extract", "remove", "split"]);
  });
});
