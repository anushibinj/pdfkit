import { describe, expect, it } from "vitest";
import {
  computeImageRedactionPixels,
  imageUserBounds,
} from "./image-redaction-math";

describe("image-redaction-math", () => {
  it("computes user-space bounding boxes for normal and rotated image matrices", () => {
    expect(imageUserBounds([200, 0, 0, 100, 50, 80])).toEqual({
      left: 50,
      bottom: 80,
      right: 250,
      top: 180,
    });
    // 90-degree rotated image: (0,1)->(-100,0), (1,0)->(0,200)
    expect(imageUserBounds([0, 200, -100, 0, 100, 50])).toEqual({
      left: 0,
      bottom: 50,
      right: 100,
      top: 250,
    });
  });

  it("maps axis-aligned redaction boxes to exact top-down pixel rectangles", () => {
    // 100x50 image drawn at user box [0..200] x [0..100]
    const matrix = [200, 0, 0, 100, 0, 0] as const;
    // Redact top-left quarter in user space: x [0..100], y [50..100]
    const result = computeImageRedactionPixels(matrix, 100, 50, [
      { left: 0, bottom: 50, right: 100, top: 100 },
    ]);
    expect(result.points).toEqual([]);
    expect(result.rects).toEqual([{ left: 0, top: 0, width: 50, height: 25 }]);
  });

  it("handles vertically flipped images (negative d) and partial overlap", () => {
    // Common top-down placement matrix: [200, 0, 0, -100, 0, 100]
    const matrix = [200, 0, 0, -100, 0, 100] as const;
    // Redact bottom-right quarter in user space: x [100..250], y [-10..50]
    const result = computeImageRedactionPixels(matrix, 100, 50, [
      { left: 100, bottom: -10, right: 250, top: 50 },
    ]);
    // In v-flipped matrix, y in [0..50] is v in [0.5..1.0], which is py in [0..25]!
    expect(result.rects).toEqual([{ left: 50, top: 0, width: 50, height: 25 }]);
  });

  it("maps rotated images per pixel and ignores non-overlapping or degenerate images", () => {
    // 4x4 image rotated 90 degrees CCW: [0, 40, -40, 0, 40, 0] -> covers x [0..40], y [0..40]
    const rotated = [0, 40, -40, 0, 40, 0] as const;
    const hit = computeImageRedactionPixels(rotated, 4, 4, [
      { left: 0, bottom: 0, right: 20, top: 20 },
    ]);
    expect(hit.rects).toEqual([]);
    expect(hit.points.length).toBe(4);

    expect(
      computeImageRedactionPixels([100, 0, 0, 100, 0, 0], 10, 10, [
        { left: 200, bottom: 200, right: 300, top: 300 },
      ]),
    ).toEqual({ rects: [], points: [] });

    expect(
      computeImageRedactionPixels([0, 0, 0, 0, 0, 0], 10, 10, [
        { left: 0, bottom: 0, right: 10, top: 10 },
      ]),
    ).toEqual({ rects: [], points: [] });
  });
});
