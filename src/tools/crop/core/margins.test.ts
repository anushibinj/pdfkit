import { describe, expect, it } from "vitest";
import type { PageBox } from "@/lib/pdfium/page-box";
import {
  MIN_CROP_SIZE,
  NO_MARGINS,
  POINTS_PER_MM,
  cropRectForPage,
  cropRectInView,
  marginsFromViewRect,
  mmToPoints,
  pointsToMm,
  validateMargins,
  viewRectToUser,
} from "./margins";

// A 600 x 400 box that does not start at the origin, to catch offset mistakes.
const box: PageBox = { left: 100, bottom: 50, right: 700, top: 450 };
const margins = { top: 10, right: 20, bottom: 30, left: 40 };

describe("validateMargins", () => {
  it("accepts valid non-negative numbers", () => {
    expect(validateMargins(NO_MARGINS)).toBeNull();
    expect(validateMargins(margins)).toBeNull();
  });

  it("reports empty or non-numeric margins", () => {
    expect(validateMargins({ ...NO_MARGINS, top: NaN })).toEqual({
      kind: "empty",
      message: "Enter a number for each margin.",
    });
    expect(validateMargins({ ...NO_MARGINS, left: Infinity })).toEqual({
      kind: "empty",
      message: "Enter a number for each margin.",
    });
  });

  it("reports negative margins", () => {
    expect(validateMargins({ ...NO_MARGINS, right: -5 })).toEqual({
      kind: "negative",
      message: "Margins cannot be negative.",
    });
  });
});

describe("mmToPoints and pointsToMm", () => {
  it("convert at 72 / 25.4 points per millimetre", () => {
    expect(mmToPoints(25.4)).toBeCloseTo(72);
    expect(pointsToMm(72)).toBeCloseTo(25.4);
    expect(pointsToMm(mmToPoints(3.7))).toBeCloseTo(3.7);
    expect(POINTS_PER_MM).toBeCloseTo(2.8346, 4);
  });
});

describe("cropRectInView", () => {
  it("keeps what lies inside the margins", () => {
    expect(cropRectInView({ width: 600, height: 400 }, margins)).toEqual({
      x: 40,
      y: 10,
      width: 540,
      height: 360,
    });
    expect(cropRectInView({ width: 50, height: 50 }, NO_MARGINS)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
  });

  it("refuses margins that leave too little, are negative or not numbers", () => {
    const view = { width: 100, height: 100 };
    const tight = 100 - MIN_CROP_SIZE;
    expect(cropRectInView(view, { ...NO_MARGINS, left: tight })).not.toBeNull();
    expect(
      cropRectInView(view, { ...NO_MARGINS, left: tight + 0.1 }),
    ).toBeNull();
    expect(cropRectInView(view, { ...NO_MARGINS, top: 95 })).toBeNull();
    expect(cropRectInView(view, { ...NO_MARGINS, right: -1 })).toBeNull();
    expect(cropRectInView(view, { ...NO_MARGINS, bottom: NaN })).toBeNull();
  });
});

describe("marginsFromViewRect", () => {
  it("is the inverse of cropRectInView", () => {
    const view = { width: 600, height: 400 };
    const rect = cropRectInView(view, margins)!;
    expect(marginsFromViewRect(view, rect)).toEqual(margins);
  });
});

describe("viewRectToUser", () => {
  const rect = { x: 40, y: 10, width: 540, height: 360 };

  it("unrotated: flips y and adds the box offset", () => {
    // View (40, 10) is user (140, 440); view (580, 370) is user (680, 80).
    expect(viewRectToUser(rect, box, 0)).toEqual({
      left: 140,
      bottom: 80,
      right: 680,
      top: 440,
    });
  });

  it("rotated pages map the displayed top edge to the right user edge", () => {
    // Turned 90 degrees clockwise the page shows 400 x 600; its displayed
    // top edge is the box's left edge (x = 100). Cutting 10 from the top
    // therefore moves the user-space left edge to 110.
    const user = viewRectToUser(
      { x: 0, y: 10, width: 400, height: 590 },
      box,
      1,
    );
    expect(user).toEqual({ left: 110, bottom: 50, right: 700, top: 450 });
  });

  it("half turns swap both axes", () => {
    const user = viewRectToUser(
      { x: 0, y: 10, width: 600, height: 390 },
      box,
      2,
    );
    // Displayed top is the box's bottom edge.
    expect(user).toEqual({ left: 100, bottom: 60, right: 700, top: 450 });
  });
});

describe("cropRectForPage", () => {
  it("applies the margins to the displayed page", () => {
    expect(cropRectForPage(box, 0, margins)).toEqual({
      left: 140,
      bottom: 80,
      right: 680,
      top: 440,
    });
    // Rotated, the 400 x 600 displayed page keeps 340 x 560.
    const rotated = cropRectForPage(box, 3, margins)!;
    expect(rotated.right - rotated.left).toBeCloseTo(560);
    expect(rotated.top - rotated.bottom).toBeCloseTo(340);
  });

  it("returns null when the margins leave too little", () => {
    expect(cropRectForPage(box, 0, { ...margins, left: 590 })).toBeNull();
  });
});
