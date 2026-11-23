import { describe, expect, it } from "vitest";
import type { PageBox, PageInfo } from "@/lib/pdfium/page-box";
import {
  boundsOfUserBoxes,
  canMergeUserBoxesOnLine,
  mergeNormalizedViewRects,
  mergeUserBoxesByLine,
  rectAnchorY,
  unionUserBox,
  unionViewRect,
  userBoxToNormalizedViewRect,
  userBoxToQuadPoints,
  userBoxesToNormalizedViewRects,
} from "./box-geometry";

describe("box-geometry", () => {
  const unrotatedInfo: PageInfo = {
    box: { left: 0, bottom: 0, right: 200, top: 400 },
    rotation: 0,
  };

  it("unions two user-space boxes", () => {
    const u = unionUserBox(
      { left: 10, bottom: 20, right: 30, top: 40 },
      { left: 25, bottom: 15, right: 50, top: 35 },
    );
    expect(u).toEqual({ left: 10, bottom: 15, right: 50, top: 40 });
  });

  it("unions two normalised view-space rects", () => {
    const u = unionViewRect(
      { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
      { left: 0.25, top: 0.15, right: 0.6, bottom: 0.35 },
    );
    expect(u).toEqual({ left: 0.1, top: 0.15, right: 0.6, bottom: 0.4 });
  });

  it("merges adjacent boxes on the same line and separates distinct lines", () => {
    const a: PageBox = { left: 10, bottom: 100, right: 30, top: 112 };
    const b: PageBox = { left: 34, bottom: 100, right: 55, top: 112 };
    const farColumn: PageBox = { left: 150, bottom: 100, right: 180, top: 112 };
    const nextLine: PageBox = { left: 10, bottom: 80, right: 40, top: 92 };

    expect(canMergeUserBoxesOnLine(a, b)).toBe(true);
    expect(canMergeUserBoxesOnLine(a, farColumn)).toBe(false);
    expect(canMergeUserBoxesOnLine(a, nextLine)).toBe(false);

    const merged = mergeUserBoxesByLine([
      a,
      b,
      { left: 0, bottom: 0, right: 0, top: 0 },
      nextLine,
    ]);
    expect(merged).toEqual([
      { left: 10, bottom: 100, right: 55, top: 112 },
      nextLine,
    ]);
  });

  it("projects user-space boxes to normalised view space across rotations", () => {
    const box: PageBox = { left: 20, bottom: 300, right: 100, top: 360 };
    const r0 = userBoxToNormalizedViewRect(box, unrotatedInfo);
    expect(r0.left).toBeCloseTo(20 / 200);
    expect(r0.right).toBeCloseTo(100 / 200);
    expect(r0.top).toBeCloseTo((400 - 360) / 400);
    expect(r0.bottom).toBeCloseTo((400 - 300) / 400);

    const r90 = userBoxToNormalizedViewRect(box, {
      ...unrotatedInfo,
      rotation: 1,
    });
    expect(r90.left).toBeGreaterThanOrEqual(0);
    expect(r90.right).toBeLessThanOrEqual(1);
    expect(r90.right).toBeGreaterThan(r90.left);
    expect(r90.bottom).toBeGreaterThan(r90.top);
  });

  it("merges normalised view rects on the same visual line", () => {
    const rects = mergeNormalizedViewRects([
      { left: 0.1, top: 0.2, right: 0.2, bottom: 0.24 },
      { left: 0.22, top: 0.2, right: 0.35, bottom: 0.24 },
      { left: 0.1, top: 0.3, right: 0.25, bottom: 0.34 },
    ]);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ left: 0.1, top: 0.2, right: 0.35, bottom: 0.24 });
  });

  it("converts user boxes directly to merged normalised view rects", () => {
    const boxes: PageBox[] = [
      { left: 20, bottom: 300, right: 40, top: 320 },
      { left: 42, bottom: 300, right: 70, top: 320 },
    ];
    const rects = userBoxesToNormalizedViewRects(boxes, unrotatedInfo);
    expect(rects).toHaveLength(1);
    expect(rects[0].left).toBeCloseTo(0.1);
    expect(rects[0].right).toBeCloseTo(0.35);
  });

  it("formats PDF QuadPoints in top-left, top-right, bottom-left, bottom-right order", () => {
    expect(
      userBoxToQuadPoints({ left: 10, bottom: 20, right: 50, top: 40 }),
    ).toEqual([10, 40, 50, 40, 10, 20, 50, 20]);
  });

  it("computes enclosing bounds and scroll anchorY", () => {
    expect(boundsOfUserBoxes([])).toBeNull();
    expect(
      boundsOfUserBoxes([
        { left: 10, bottom: 20, right: 30, top: 40 },
        { left: 5, bottom: 10, right: 25, top: 50 },
      ]),
    ).toEqual({ left: 5, bottom: 10, right: 30, top: 50 });

    expect(rectAnchorY([])).toBe(0);
    expect(
      rectAnchorY([
        { left: 0.1, top: 0.5, right: 0.2, bottom: 0.55 },
        { left: 0.1, top: 0.25, right: 0.2, bottom: 0.3 },
      ]),
    ).toBe(0.25);
  });
});
