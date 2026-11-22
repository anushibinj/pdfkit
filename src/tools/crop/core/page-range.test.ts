import { describe, expect, it } from "vitest";
import { allPages, parsePageRange } from "./page-range";

describe("parsePageRange", () => {
  it("reads single pages and ranges, sorted and without repeats", () => {
    expect(parsePageRange("1-3, 7, 2", 10)).toEqual({
      ok: true,
      pages: [0, 1, 2, 6],
    });
    expect(parsePageRange(" 5 ,, 5-5 ", 5)).toEqual({ ok: true, pages: [4] });
  });

  it.each([
    ["", "Enter the pages"],
    [" , ", "Enter the pages"],
    ["a", "not a page"],
    ["1-", "not a page"],
    ["-2", "not a page"],
    ["1.5", "not a page"],
    ["0", "from 1 to 3"],
    ["2-4", "from 1 to 3"],
    ["3-1", "runs backwards"],
  ])("rejects %j", (text, message) => {
    const result = parsePageRange(text, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it("rejects absurdly long input", () => {
    expect(parsePageRange("1,".repeat(600), 3).ok).toBe(false);
  });
});

describe("allPages", () => {
  it("lists every index", () => {
    expect(allPages(3)).toEqual([0, 1, 2]);
    expect(allPages(0)).toEqual([]);
  });
});
