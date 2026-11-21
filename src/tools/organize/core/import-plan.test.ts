import { describe, expect, it } from "vitest";
import { planImports } from "./import-plan";
import type { OutputPage } from "./output-plan";

const page = (
  sourceId: string,
  pageIndex: number,
  rotation: 0 | 1 | 2 | 3 = 0,
): OutputPage => ({ kind: "source", sourceId, pageIndex, rotation });
const blank = (width = 100, height = 200): OutputPage => ({
  kind: "blank",
  width,
  height,
  rotation: 0,
});

/**
 * Simulate PDFium: append each batch and blank, then apply moveOrder the
 * way `FPDF_MovePages(doc, moveOrder, n, 0)` does. Returns a label per
 * output page ("a0", "blank"), so a test can compare it with the request.
 */
function simulate(pages: OutputPage[]): string[] {
  const plan = planImports(pages);
  const appended = [
    ...plan.batches.flatMap((b) =>
      b.pageIndices.map((i) => `${b.sourceId}${i}`),
    ),
    ...plan.blanks.map(() => "blank"),
  ];
  return plan.moveOrder.map((i) => appended[i]);
}
const label = (p: OutputPage) =>
  p.kind === "blank" ? "blank" : `${p.sourceId}${p.pageIndex}`;

describe("planImports", () => {
  it("follows the worked example", () => {
    const pages = [
      page("A", 0),
      page("B", 0),
      page("A", 1),
      blank(),
      page("A", 0),
      page("B", 1),
    ];
    const plan = planImports(pages);
    expect(plan.batches).toEqual([
      { sourceId: "A", pageIndices: [0, 1] },
      { sourceId: "B", pageIndices: [0, 1] },
      { sourceId: "A", pageIndices: [0] },
    ]);
    expect(plan.blanks).toEqual([{ width: 100, height: 200 }]);
    expect(plan.moveOrder).toEqual([0, 2, 1, 5, 4, 3]);
  });

  it("uses one import call per file when nothing is duplicated", () => {
    // Two files interleaved page by page: still only two calls.
    const pages = [0, 1, 2].flatMap((i) => [page("f", i), page("b", 2 - i)]);
    const plan = planImports(pages);
    expect(plan.batches).toHaveLength(2);
    expect(simulate(pages)).toEqual(pages.map(label));
  });

  it("never puts the same page twice into one call", () => {
    const pages = [page("a", 0), page("a", 0), page("a", 0), page("a", 1)];
    const plan = planImports(pages);
    for (const batch of plan.batches) {
      expect(new Set(batch.pageIndices).size).toBe(batch.pageIndices.length);
    }
    expect(plan.batches).toHaveLength(3);
    expect(simulate(pages)).toEqual(pages.map(label));
  });

  it("keeps the rotations by output position", () => {
    const plan = planImports([page("a", 1, 3), blank(), page("a", 0, 1)]);
    expect(plan.rotations).toEqual([3, 0, 1]);
  });

  it("produces a permutation of every appended page", () => {
    const pages = [blank(), page("x", 4), page("y", 0), blank(), page("x", 4)];
    const { moveOrder } = planImports(pages);
    expect([...moveOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(simulate(pages)).toEqual(pages.map(label));
  });

  it("handles blanks only", () => {
    const plan = planImports([blank(1, 2), blank(3, 4)]);
    expect(plan.batches).toEqual([]);
    expect(plan.moveOrder).toEqual([0, 1]);
  });
});
