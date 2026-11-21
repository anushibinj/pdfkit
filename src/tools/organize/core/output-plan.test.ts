import { describe, expect, it } from "vitest";
import { InvalidPlanError } from "@/tools/edit/core/sanitize-plan";
import { MAX_BOARD_PAGES, type BoardPage } from "./board";
import {
  MAX_SOURCE_ID_LENGTH,
  buildOutputPlan,
  isSourceId,
  sanitizeOutputPlan,
  type OutputPage,
} from "./output-plan";

const counts = new Map([
  ["a", 3],
  ["b", 1],
]);
const ok: OutputPage[] = [
  { kind: "source", sourceId: "a", pageIndex: 2, rotation: 1 },
  { kind: "blank", width: 612, height: 792, rotation: 0 },
  { kind: "source", sourceId: "b", pageIndex: 0, rotation: 3 },
];

describe("buildOutputPlan", () => {
  it("drops keys and keeps everything the worker needs", () => {
    const pages: BoardPage[] = [
      { kind: "source", key: "k1", sourceId: "a", pageIndex: 2, rotation: 1 },
      { kind: "blank", key: "k2", width: 612, height: 792, rotation: 0 },
    ];
    expect(buildOutputPlan(pages)).toEqual(ok.slice(0, 2));
  });
});

describe("isSourceId", () => {
  it("accepts short non-empty strings only", () => {
    expect(isSourceId("s1")).toBe(true);
    expect(isSourceId("")).toBe(false);
    expect(isSourceId("x".repeat(MAX_SOURCE_ID_LENGTH + 1))).toBe(false);
    expect(isSourceId(7)).toBe(false);
  });
});

describe("sanitizeOutputPlan", () => {
  it("passes a valid plan through as a clean copy", () => {
    const withExtra = ok.map((p) => ({ ...p, evil: "<script>" }));
    const clean = sanitizeOutputPlan(withExtra, counts);
    expect(clean).toEqual(ok);
    expect(clean[0]).not.toHaveProperty("evil");
  });

  it.each([
    ["not a list", { pages: [] }],
    ["empty", []],
    ["not an object", [null]],
    ["unknown kind", [{ kind: "image", rotation: 0 }]],
    ["bad rotation", [{ ...ok[0], rotation: 4 }]],
    ["missing rotation", [{ kind: "source", sourceId: "a", pageIndex: 0 }]],
    ["unknown file", [{ ...ok[0], sourceId: "zz" }]],
    ["non-string file", [{ ...ok[0], sourceId: 1 }]],
    ["page out of range", [{ ...ok[0], pageIndex: 3 }]],
    ["negative page", [{ ...ok[0], pageIndex: -1 }]],
    ["fractional page", [{ ...ok[0], pageIndex: 0.5 }]],
    ["tiny blank", [{ ...ok[1], width: 1 }]],
    ["huge blank", [{ ...ok[1], height: 20_000 }]],
    ["NaN blank", [{ ...ok[1], width: Number.NaN }]],
    ["string blank", [{ ...ok[1], width: "612" }]],
  ])("rejects a plan that is %s", (_name, raw) => {
    expect(() => sanitizeOutputPlan(raw, counts)).toThrow(InvalidPlanError);
  });

  it("rejects a plan that is too long", () => {
    const long = Array(MAX_BOARD_PAGES + 1).fill(ok[1]);
    expect(() => sanitizeOutputPlan(long, counts)).toThrow(/more than/);
  });

  it("names the bad page in the message", () => {
    expect(() =>
      sanitizeOutputPlan([ok[0], { ...ok[0], pageIndex: 9 }], counts),
    ).toThrow("page 2 does not exist in its file");
  });
});
