import { describe, expect, it } from "vitest";
import {
  buildReportFileName,
  flattenTextChanges,
  formatPairLabel,
  stepCyclicIndex,
} from "./compare-navigation";
import type { AlignedPagePair, CompareSummary } from "./core/model";

describe("compare-navigation", () => {
  const pair0: AlignedPagePair = {
    pairIndex: 0,
    leftIndex: 0,
    rightIndex: 0,
    status: "matched",
    similarity: 0.9,
    leftHasText: true,
    rightHasText: true,
    leftInfo: null,
    rightInfo: null,
    changes: [
      {
        id: "p0-c0",
        pairIndex: 0,
        kind: "modified",
        leftText: "old",
        rightText: "new",
        leftUserRects: [],
        rightUserRects: [],
        leftViewRects: [],
        rightViewRects: [],
        anchorY: 0.2,
      },
    ],
  };

  const pair1: AlignedPagePair = {
    pairIndex: 1,
    leftIndex: null,
    rightIndex: 1,
    status: "added",
    similarity: 0,
    leftHasText: false,
    rightHasText: true,
    leftInfo: null,
    rightInfo: null,
    changes: [
      {
        id: "p1-c0",
        pairIndex: 1,
        kind: "added",
        leftText: "",
        rightText: "extra page",
        leftUserRects: [],
        rightUserRects: [],
        leftViewRects: [],
        rightViewRects: [],
        anchorY: 0.1,
      },
    ],
  };

  const pair2: AlignedPagePair = {
    pairIndex: 2,
    leftIndex: 1,
    rightIndex: null,
    status: "removed",
    similarity: 0,
    leftHasText: true,
    rightHasText: false,
    leftInfo: null,
    rightInfo: null,
    changes: [],
  };

  const summary: CompareSummary = {
    leftFileName: "a.pdf",
    rightFileName: "b.pdf",
    leftPageCount: 2,
    rightPageCount: 2,
    pairs: [pair0, pair1, pair2],
    totalChanges: 2,
    addedWords: 3,
    removedWords: 1,
    scannedPagesCount: 0,
  };

  it("flattens text changes across pairs", () => {
    expect(flattenTextChanges(null)).toEqual([]);
    const flat = flattenTextChanges(summary);
    expect(flat).toHaveLength(2);
    expect(flat[0]).toMatchObject({ globalIndex: 0, pairIndex: 0 });
    expect(flat[1]).toMatchObject({ globalIndex: 1, pairIndex: 1 });
  });

  it("steps cyclic index forward and backward cleanly", () => {
    expect(stepCyclicIndex(-1, 0, 1)).toBe(-1);
    expect(stepCyclicIndex(-1, 3, 1)).toBe(0);
    expect(stepCyclicIndex(-1, 3, -1)).toBe(2);
    expect(stepCyclicIndex(2, 3, 1)).toBe(0);
    expect(stepCyclicIndex(0, 3, -1)).toBe(2);
  });

  it("formats pair labels and report filenames", () => {
    expect(formatPairLabel(pair0)).toBe("Original p.1 ↔ Revised p.1");
    expect(formatPairLabel(pair1)).toBe("Added: Revised p.2");
    expect(formatPairLabel(pair2)).toBe("Removed: Original p.2");
    expect(buildReportFileName("contract-v1.pdf", "contract-v2.PDF")).toBe(
      "contract-v1-vs-contract-v2-comparison.pdf",
    );
  });
});
