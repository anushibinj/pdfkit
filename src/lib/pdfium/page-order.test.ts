import { describe, expect, it } from "vitest";
import { planPageOperations } from "./page-order";

/** Replays the plan on an array the way PDFium would, to check the result. */
function simulate(pageCount: number, order: number[]): number[] {
  const { deletions, moveOrder } = planPageOperations(pageCount, order);
  let pages = Array.from({ length: pageCount }, (_, i) => i);
  for (const i of deletions) pages.splice(i, 1);
  if (moveOrder) pages = moveOrder.map((i) => pages[i]);
  return pages;
}

describe("planPageOperations", () => {
  it("does nothing for an unchanged document", () => {
    expect(planPageOperations(3, [0, 1, 2])).toEqual({
      deletions: [],
      moveOrder: null,
    });
  });

  it("deletes from the highest index down", () => {
    expect(planPageOperations(5, [0, 2])).toEqual({
      deletions: [4, 3, 1],
      moveOrder: null,
    });
  });

  it("follows the worked example from the documentation", () => {
    expect(planPageOperations(5, [3, 0, 2])).toEqual({
      deletions: [4, 1],
      moveOrder: [2, 0, 1],
    });
  });

  it.each([[[2, 1, 0]], [[1, 0, 2, 3]], [[3, 1]], [[0]], [[4, 3, 2, 1, 0]]])(
    "produces the requested order %j",
    (order) => {
      expect(simulate(5, order)).toEqual(order);
    },
  );

  it.each([[[]], [[0, 0]], [[5]], [[-1]], [[1.5]]])(
    "rejects the invalid order %j",
    (order) => {
      expect(() => planPageOperations(5, order)).toThrow("Invalid page order");
    },
  );
});
