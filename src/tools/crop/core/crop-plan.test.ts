import { describe, expect, it } from "vitest";
import type { PageInfo } from "@/lib/pdfium/pdfium-document";
import {
  FLAG_REMOVE_OUTSIDE,
  InvalidCropPlanError,
  PLAN_VERSION,
  buildCropPlan,
  encodeCropPlan,
  sanitizeCropPlan,
} from "./crop-plan";

const pages: PageInfo[] = [
  { box: { left: 0, bottom: 0, right: 600, top: 800 }, rotation: 0 },
  { box: { left: 0, bottom: 0, right: 100, top: 100 }, rotation: 1 },
];
const margins = { top: 10, right: 20, bottom: 30, left: 40 };

describe("buildCropPlan", () => {
  it("applies the margins to each selected page", () => {
    const result = buildCropPlan(pages, [0, 1], margins, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.removeOutside).toBe(true);
    expect(result.plan.pages[0]).toEqual({
      pageIndex: 0,
      rect: { left: 40, bottom: 30, right: 580, top: 790 },
    });
    // Page 2 is shown turned: its displayed top edge is the box's left.
    expect(result.plan.pages[1].rect.left).toBe(10);
  });

  it("names the first page the margins do not fit", () => {
    const result = buildCropPlan(
      pages,
      [0, 1],
      { ...margins, left: 80 },
      false,
    );
    expect(result).toEqual({
      ok: false,
      pageIndex: 1,
      message: "The margins leave nothing to keep on page 2.",
    });
  });

  it("explains empty or negative margins with specific messages", () => {
    const empty = buildCropPlan(pages, [0], { ...margins, top: NaN }, false);
    expect(empty).toEqual({
      ok: false,
      pageIndex: -1,
      message: "Enter a number for each margin.",
    });

    const negative = buildCropPlan(pages, [0], { ...margins, right: -5 }, false);
    expect(negative).toEqual({
      ok: false,
      pageIndex: -1,
      message: "Margins cannot be negative.",
    });
  });

  it("refuses an empty selection or a missing page", () => {
    expect(buildCropPlan(pages, [], margins, false).ok).toBe(false);
    const missing = buildCropPlan(pages, [5], margins, false);
    expect(missing).toMatchObject({ ok: false, pageIndex: 5 });
  });
});

describe("encodeCropPlan", () => {
  it("writes little-endian doubles in the module's order", () => {
    const bytes = encodeCropPlan({
      removeOutside: true,
      pages: [{ pageIndex: 2, rect: { left: 1, bottom: 2, right: 3, top: 4 } }],
    });
    const view = new DataView(bytes.buffer);
    const numbers = Array.from({ length: bytes.length / 8 }, (_, i) =>
      view.getFloat64(i * 8, true),
    );
    expect(numbers).toEqual([
      PLAN_VERSION,
      FLAG_REMOVE_OUTSIDE,
      1,
      2,
      1,
      2,
      3,
      4,
    ]);
    const hideOnly = encodeCropPlan({ removeOutside: false, pages: [] });
    expect(new DataView(hideOnly.buffer).getFloat64(8, true)).toBe(0);
  });
});

describe("sanitizeCropPlan", () => {
  const good = {
    removeOutside: true,
    pages: [{ pageIndex: 0, rect: { left: 1, bottom: 2, right: 3, top: 4 } }],
  };

  it("keeps a well-formed plan and drops unknown fields", () => {
    const plan = sanitizeCropPlan({ ...good, extra: 1 }, 2);
    expect(plan).toEqual(good);
    expect(
      sanitizeCropPlan({ ...good, removeOutside: "yes" }, 2).removeOutside,
    ).toBe(false);
  });

  it.each([
    ["not an object", null],
    ["no pages", { pages: [] }],
    ["pages not a list", { pages: {} }],
    ["entry not an object", { pages: [1] }],
    [
      "index out of range",
      { pages: [{ pageIndex: 2, rect: good.pages[0].rect }] },
    ],
    [
      "fractional index",
      { pages: [{ pageIndex: 0.5, rect: good.pages[0].rect }] },
    ],
    ["repeated page", { pages: [good.pages[0], good.pages[0]] }],
    [
      "NaN side",
      { pages: [{ pageIndex: 0, rect: { ...good.pages[0].rect, top: NaN } }] },
    ],
    [
      "empty rect",
      {
        pages: [
          { pageIndex: 0, rect: { left: 3, bottom: 2, right: 3, top: 4 } },
        ],
      },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(() => sanitizeCropPlan(raw, 2)).toThrow(InvalidCropPlanError);
  });
});
