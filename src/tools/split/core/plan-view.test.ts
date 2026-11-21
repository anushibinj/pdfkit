import { describe, expect, it } from "vitest";
import { actionLabel, filesLabel, filesPerPage, planKey } from "./plan-view";

describe("filesPerPage", () => {
  it("lists the files each page goes into", () => {
    expect(
      filesPerPage([{ pages: [0, 1] }, { pages: [1, 2] }, { pages: [0] }], 4),
    ).toEqual([[1, 3], [1, 2], [2], []]);
  });

  it("counts a page once per file", () => {
    expect(filesPerPage([{ pages: [0, 1, 0] }], 2)).toEqual([[1], [1]]);
  });

  it("ignores pages outside the document", () => {
    expect(filesPerPage([{ pages: [5] }], 2)).toEqual([[], []]);
  });
});

describe("filesLabel", () => {
  it.each([
    [[2], "File 2"],
    [[1, 3], "Files 1, 3"],
    [[], "Not in any file"],
  ])("%j -> %s", (files, label) => {
    expect(filesLabel(files)).toBe(label);
  });
});

describe("planKey", () => {
  it("is equal for equal plans and differs otherwise", () => {
    const a = planKey("split", [{ pages: [0, 1] }, { pages: [2] }]);
    expect(planKey("split", [{ pages: [0, 1] }, { pages: [2] }])).toBe(a);
    expect(planKey("split", [{ pages: [0] }, { pages: [1, 2] }])).not.toBe(a);
    expect(planKey("extract", [{ pages: [0, 1, 2] }])).not.toBe(
      planKey("remove", [{ pages: [0, 1, 2] }]),
    );
  });
});

describe("actionLabel", () => {
  const ok = (...outputs: number[][]) => ({
    ok: true as const,
    outputs: outputs.map((pages) => ({ pages })),
  });
  const bad = { ok: false as const, error: "x" };

  it("says how much the button will do", () => {
    expect(actionLabel("split", ok([0], [1]), 2)).toBe("Split into 2 files");
    expect(actionLabel("extract", ok([0, 2, 3]), 5)).toBe("Extract 3 pages");
    expect(actionLabel("extract", ok([4]), 5)).toBe("Extract 1 page");
    // 5 pages, 3 kept: 2 removed
    expect(actionLabel("remove", ok([0, 1, 2]), 5)).toBe("Remove 2 pages");
    expect(actionLabel("remove", ok([0, 1, 2, 3]), 5)).toBe("Remove 1 page");
  });

  it("names the action when there is no valid plan", () => {
    expect(actionLabel("split", bad, 5)).toBe("Split PDF");
    expect(actionLabel("extract", bad, 5)).toBe("Extract pages");
    expect(actionLabel("remove", bad, 5)).toBe("Remove pages");
  });
});
