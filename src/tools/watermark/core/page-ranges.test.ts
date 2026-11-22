import { describe, expect, it } from "vitest";
import { parsePageSelection } from "@/lib/page-ranges";
import { formatPageRanges, parsePageRanges } from "./page-ranges";

describe("parsePageRanges", () => {
  it("is the shared page selection parser", () => {
    expect(parsePageRanges).toBe(parsePageSelection);
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
