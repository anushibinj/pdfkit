import { describe, expect, it } from "vitest";
import type { Matrix } from "@/lib/affine";
import type { QuarterTurns } from "@/lib/pdfium/page-box";
import {
  MAX_PDF_PAGE_POINTS,
  StandardPageLayoutCalculator,
  clampToMaxSide,
  computeImageMatrix,
  computePageLayout,
  effectiveImageSize,
  resolvePageDimensions,
} from "./layout";
import { FIXED_PAPER_POINTS, type PageLayoutOptions } from "./options";

/** Apply a 6-element PDF affine matrix to a unit-square point `(x, y)`. */
function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

describe("images-to-pdf layout", () => {
  describe("effectiveImageSize", () => {
    it("keeps dimensions for 0 and 180 degrees and swaps for 90 and 270 degrees", () => {
      expect(effectiveImageSize(800, 600, 0)).toEqual({ width: 800, height: 600 });
      expect(effectiveImageSize(800, 600, 1)).toEqual({ width: 600, height: 800 });
      expect(effectiveImageSize(800, 600, 2)).toEqual({ width: 800, height: 600 });
      expect(effectiveImageSize(800, 600, 3)).toEqual({ width: 600, height: 800 });
    });
  });

  describe("clampToMaxSide", () => {
    it("leaves boxes within the limit unchanged", () => {
      expect(clampToMaxSide(1000, 500)).toEqual({ width: 1000, height: 500 });
    });

    it("scales oversized boxes proportionally to MAX_PDF_PAGE_POINTS", () => {
      const clamped = clampToMaxSide(28800, 14400);
      expect(clamped.width).toBeCloseTo(MAX_PDF_PAGE_POINTS);
      expect(clamped.height).toBeCloseTo(MAX_PDF_PAGE_POINTS / 2);
    });
  });

  describe("resolvePageDimensions", () => {
    it("sizes page to image plus margin in fit mode", () => {
      const opts: PageLayoutOptions = {
        pageSize: "fit",
        orientation: "auto",
        marginMm: 0,
        scaleMode: "contain",
      };
      expect(resolvePageDimensions({ width: 400, height: 300 }, opts)).toEqual({
        width: 400,
        height: 300,
      });
    });

    it("auto-orients fixed paper to landscape for wide images and portrait for tall ones", () => {
      const opts: PageLayoutOptions = {
        pageSize: "A4",
        orientation: "auto",
        marginMm: 10,
        scaleMode: "contain",
      };
      expect(resolvePageDimensions({ width: 1200, height: 800 }, opts)).toEqual({
        width: FIXED_PAPER_POINTS.A4.height,
        height: FIXED_PAPER_POINTS.A4.width,
      });
      expect(resolvePageDimensions({ width: 800, height: 1200 }, opts)).toEqual(
        FIXED_PAPER_POINTS.A4,
      );
    });

    it("honours explicit portrait and landscape overrides", () => {
      const portrait: PageLayoutOptions = {
        pageSize: "Letter",
        orientation: "portrait",
        marginMm: 0,
        scaleMode: "contain",
      };
      const landscape: PageLayoutOptions = { ...portrait, orientation: "landscape" };
      expect(resolvePageDimensions({ width: 1200, height: 600 }, portrait)).toEqual(
        FIXED_PAPER_POINTS.Letter,
      );
      expect(resolvePageDimensions({ width: 600, height: 1200 }, landscape)).toEqual({
        width: FIXED_PAPER_POINTS.Letter.height,
        height: FIXED_PAPER_POINTS.Letter.width,
      });
    });
  });

  describe("computeImageMatrix", () => {
    const left = 50;
    const bottom = 100;
    const w = 200;
    const h = 300;

    it.each<QuarterTurns>([0, 1, 2, 3])(
      "maps unit square to target rectangle with positive determinant for turns=%i",
      (turns) => {
        const m = computeImageMatrix(left, bottom, w, h, turns);
        // Determinant a*d - b*c must be strictly positive (no mirror flip).
        expect(m[0] * m[3] - m[1] * m[2]).toBeCloseTo(w * h);

        const corners = [
          applyMatrix(m, 0, 0),
          applyMatrix(m, 1, 0),
          applyMatrix(m, 0, 1),
          applyMatrix(m, 1, 1),
        ];
        const xs = corners.map(([x]) => x);
        const ys = corners.map(([, y]) => y);
        expect(Math.min(...xs)).toBeCloseTo(left);
        expect(Math.max(...xs)).toBeCloseTo(left + w);
        expect(Math.min(...ys)).toBeCloseTo(bottom);
        expect(Math.max(...ys)).toBeCloseTo(bottom + h);
      },
    );

    it("maps image top-left (0,1) to the expected corner for each clockwise rotation", () => {
      expect(applyMatrix(computeImageMatrix(left, bottom, w, h, 0), 0, 1)).toEqual([
        left,
        bottom + h,
      ]);
      expect(applyMatrix(computeImageMatrix(left, bottom, w, h, 1), 0, 1)).toEqual([
        left + w,
        bottom + h,
      ]);
      expect(applyMatrix(computeImageMatrix(left, bottom, w, h, 2), 0, 1)).toEqual([
        left + w,
        bottom,
      ]);
      expect(applyMatrix(computeImageMatrix(left, bottom, w, h, 3), 0, 1)).toEqual([
        left,
        bottom,
      ]);
    });
  });

  describe("computePageLayout", () => {
    it("throws RangeError on non-positive or non-finite image dimensions", () => {
      const opts: PageLayoutOptions = {
        pageSize: "A4",
        orientation: "auto",
        marginMm: 10,
        scaleMode: "contain",
      };
      expect(() => computePageLayout(0, 100, 0, opts)).toThrow(RangeError);
      expect(() => computePageLayout(100, -5, 0, opts)).toThrow(RangeError);
      expect(() => computePageLayout(Number.NaN, 100, 0, opts)).toThrow(
        RangeError,
      );
    });

    it("centers and scales an image inside A4 margins in contain mode", () => {
      const layout = computePageLayout(1000, 500, 0, {
        pageSize: "A4",
        orientation: "portrait",
        marginMm: 0,
        scaleMode: "contain",
      });
      expect(layout.pageWidth).toBeCloseTo(FIXED_PAPER_POINTS.A4.width);
      expect(layout.drawnWidth).toBeCloseTo(FIXED_PAPER_POINTS.A4.width);
      expect(layout.drawnHeight).toBeCloseTo(FIXED_PAPER_POINTS.A4.width / 2);
      // Centered vertically: bottom = (pageHeight - drawnHeight) / 2.
      expect(layout.matrix[5]).toBeCloseTo(
        (layout.pageHeight - layout.drawnHeight) / 2,
      );
    });

    it("preserves 72 DPI size for small images in actual mode while shrinking oversized ones", () => {
      const small = computePageLayout(200, 100, 0, {
        pageSize: "Letter",
        orientation: "portrait",
        marginMm: 0,
        scaleMode: "actual",
      });
      expect(small.drawnWidth).toBeCloseTo(200);
      expect(small.drawnHeight).toBeCloseTo(100);

      const huge = computePageLayout(2000, 1000, 0, {
        pageSize: "Letter",
        orientation: "portrait",
        marginMm: 0,
        scaleMode: "actual",
      });
      expect(huge.drawnWidth).toBeCloseTo(FIXED_PAPER_POINTS.Letter.width);
      expect(huge.drawnHeight).toBeCloseTo(FIXED_PAPER_POINTS.Letter.width / 2);
    });

    it("delegates via StandardPageLayoutCalculator.compute", () => {
      const calc = new StandardPageLayoutCalculator();
      const opts: PageLayoutOptions = {
        pageSize: "fit",
        orientation: "auto",
        marginMm: 0,
        scaleMode: "contain",
      };
      expect(calc.compute(300, 200, 1, opts)).toEqual(
        computePageLayout(300, 200, 1, opts),
      );
    });
  });
});
