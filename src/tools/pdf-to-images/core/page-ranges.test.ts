import { describe, expect, it } from "vitest";
import { parsePageRanges } from "./page-ranges";

const pages = (text: string, count = 10) => {
  const result = parsePageRanges(text, count);
  if (!result.ok) throw new Error(result.error);
  return result.pages;
};
const error = (text: string, count = 10) => {
  const result = parsePageRanges(text, count);
  if (result.ok) throw new Error("expected an error");
  return result.error;
};

describe("parsePageRanges", () => {
  it("selects every page for empty input", () => {
    expect(pages("", 3)).toEqual([0, 1, 2]);
    expect(pages("   ", 2)).toEqual([0, 1]);
    expect(pages(" , ", 2)).toEqual([0, 1]);
  });

  it("reads single pages and ranges as zero-based indices", () => {
    expect(pages("1")).toEqual([0]);
    expect(pages("2-4")).toEqual([1, 2, 3]);
    expect(pages("1, 3, 5-6")).toEqual([0, 2, 4, 5]);
  });

  it("supports open-ended ranges", () => {
    expect(pages("8-")).toEqual([7, 8, 9]);
    expect(pages("-3")).toEqual([0, 1, 2]);
  });

  it("tolerates spaces, en dashes and stray commas", () => {
    expect(pages(" 2 - 3 ,5,, ")).toEqual([1, 2, 4]);
    expect(pages("2–4")).toEqual([1, 2, 3]);
  });

  it("sorts and removes duplicates", () => {
    expect(pages("5, 1-3, 2")).toEqual([0, 1, 2, 4]);
  });

  it("rejects pages outside the document", () => {
    expect(error("0")).toBe("Page 0 does not exist. This PDF has 10 pages.");
    expect(error("4-12")).toMatch(/Page 12 does not exist/);
    expect(error("2", 1)).toBe("Page 2 does not exist. This PDF has 1 page.");
  });

  it("rejects backwards ranges with a hint", () => {
    expect(error("5-3")).toBe("“5-3” goes backwards. Write it as 3-5.");
  });

  it.each(["abc", "-", "1-2-3", "1.5", "3 4", "#2"])("rejects %j", (text) => {
    expect(error(text)).toMatch(/is not a page number or range/);
  });
});
