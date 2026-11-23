import { describe, expect, it } from "vitest";
import {
  MultisetDiceSimilarity,
  alignPages,
  type PageSignature,
  type PageSimilarityMetric,
} from "./page-alignment";

function sig(pageIndex: number, words: string, aspectRatio = 0.77): PageSignature {
  return {
    pageIndex,
    words: words ? words.split(/\s+/) : [],
    aspectRatio,
  };
}

describe("page-alignment", () => {
  it("scores identical, partial, disjoint, and blank pages with MultisetDiceSimilarity", () => {
    const metric = new MultisetDiceSimilarity();
    expect(metric.score(sig(0, "alpha beta gamma"), sig(0, "alpha beta gamma"))).toBe(1);
    expect(metric.score(sig(0, "alpha beta"), sig(0, "gamma delta"))).toBe(0);
    expect(metric.score(sig(0, "alpha beta gamma"), sig(0, "alpha beta delta"))).toBeCloseTo(
      2 / 3,
    );
    expect(metric.score(sig(0, ""), sig(0, "alpha"))).toBe(0);
    expect(metric.score(sig(0, "", 0.77), sig(0, "", 0.77))).toBeGreaterThan(0.5);
  });

  it("handles empty document on either side", () => {
    expect(alignPages([], [sig(0, "a"), sig(1, "b")])).toEqual([
      { leftIndex: null, rightIndex: 0, status: "added", similarity: 0 },
      { leftIndex: null, rightIndex: 1, status: "added", similarity: 0 },
    ]);
    expect(alignPages([sig(0, "a")], [])).toEqual([
      { leftIndex: 0, rightIndex: null, status: "removed", similarity: 0 },
    ]);
  });

  it("keeps later pages aligned when a new page is inserted in the middle", () => {
    const left = [
      sig(0, "introduction agreement terms payment"),
      sig(1, "confidentiality obligations duration"),
      sig(2, "governing law arbitration venue"),
    ];
    const right = [
      sig(0, "introduction agreement terms payment"),
      sig(1, "newly inserted exhibit schedule pricing"),
      sig(2, "confidentiality obligations duration"),
      sig(3, "governing law arbitration venue"),
    ];

    const aligned = alignPages(left, right);
    expect(aligned).toEqual([
      { leftIndex: 0, rightIndex: 0, status: "matched", similarity: 1 },
      { leftIndex: null, rightIndex: 1, status: "added", similarity: 0 },
      { leftIndex: 1, rightIndex: 2, status: "matched", similarity: 1 },
      { leftIndex: 2, rightIndex: 3, status: "matched", similarity: 1 },
    ]);
  });

  it("keeps later pages aligned when a page is removed in the middle", () => {
    const left = [
      sig(0, "cover summary contract"),
      sig(1, "removed appendix table figures"),
      sig(2, "signatures witness date"),
    ];
    const right = [
      sig(0, "cover summary contract"),
      sig(1, "signatures witness date"),
    ];

    const aligned = alignPages(left, right);
    expect(aligned).toEqual([
      { leftIndex: 0, rightIndex: 0, status: "matched", similarity: 1 },
      { leftIndex: 1, rightIndex: null, status: "removed", similarity: 0 },
      { leftIndex: 2, rightIndex: 1, status: "matched", similarity: 1 },
    ]);
  });

  it("pairs a completely rewritten page in place instead of splitting into removed+added", () => {
    const left = [
      sig(0, "page one header"),
      sig(1, "old completely different text"),
      sig(2, "page three footer"),
    ];
    const right = [
      sig(0, "page one header"),
      sig(1, "new rewritten clause alpha"),
      sig(2, "page three footer"),
    ];

    const aligned = alignPages(left, right);
    expect(aligned).toHaveLength(3);
    expect(aligned[1]).toEqual({
      leftIndex: 1,
      rightIndex: 1,
      status: "matched",
      similarity: 0,
    });
  });

  it("accepts an injected custom PageSimilarityMetric (OCP/DIP)", () => {
    const customMetric: PageSimilarityMetric = {
      score: (l, r) => (l.pageIndex === r.pageIndex ? 1 : 0),
    };
    const aligned = alignPages(
      [sig(0, "a"), sig(1, "b")],
      [sig(0, "x"), sig(1, "y")],
      customMetric,
    );
    expect(aligned.every((p) => p.status === "matched")).toBe(true);
  });
});
