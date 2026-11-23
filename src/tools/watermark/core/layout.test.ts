import { describe, expect, it } from "vitest";
import { applyToPoint, type Point } from "@/lib/affine";
import {
  MAX_TILES,
  anchorCenter,
  layoutWatermark,
  pageMargin,
  placeAt,
  rotatedBounds,
  rotationMatrix,
  tileCenters,
} from "./layout";
import { ANCHORS } from "./model";

const round = (p: Point) => ({
  x: Math.round(p.x * 1000) / 1000,
  y: Math.round(p.y * 1000) / 1000,
});
const LETTER = { width: 612, height: 792 };

describe("pageMargin", () => {
  it("is half an inch on Letter and A4 and a sixteenth of the short side on small pages", () => {
    expect(pageMargin(LETTER)).toBe(36);
    expect(pageMargin({ width: 595, height: 842 })).toBe(36);
    expect(pageMargin({ width: 100, height: 200 })).toBe(6.25);
  });
});

describe("rotationMatrix", () => {
  it("turns counter-clockwise", () => {
    expect(round(applyToPoint(rotationMatrix(90), { x: 1, y: 0 }))).toEqual({
      x: 0,
      y: 1,
    });
    expect(round(applyToPoint(rotationMatrix(-90), { x: 1, y: 0 }))).toEqual({
      x: 0,
      y: -1,
    });
  });
});

describe("rotatedBounds", () => {
  it.each([
    [0, 200, 50],
    [90, 50, 200],
    [180, 200, 50],
    [-90, 50, 200],
  ])("%d° of 200x50 -> %dx%d", (deg, w, h) => {
    const b = rotatedBounds({ width: 200, height: 50 }, deg);
    expect(b.width).toBeCloseTo(w, 6);
    expect(b.height).toBeCloseTo(h, 6);
  });

  it("makes a square at 45°", () => {
    const b = rotatedBounds({ width: 200, height: 50 }, 45);
    expect(b.width).toBeCloseTo(250 / Math.SQRT2, 6);
    expect(b.height).toBeCloseTo(250 / Math.SQRT2, 6);
  });
});

describe("placeAt", () => {
  const content = { width: 100, height: 20 };

  it("puts the content's centre on the point, whatever the angle", () => {
    for (const deg of [0, 30, 90, -135]) {
      const m = placeAt({ x: 300, y: 400 }, content, deg);
      expect(round(applyToPoint(m, { x: 50, y: 10 }))).toEqual({
        x: 300,
        y: 400,
      });
    }
  });

  it("rotates about the centre", () => {
    const flat = placeAt({ x: 300, y: 400 }, content, 0);
    expect(round(applyToPoint(flat, { x: 0, y: 0 }))).toEqual({
      x: 250,
      y: 390,
    });
    // a quarter turn left: the box's bottom-left corner goes to the bottom-right
    const turned = placeAt({ x: 300, y: 400 }, content, 90);
    expect(round(applyToPoint(turned, { x: 0, y: 0 }))).toEqual({
      x: 310,
      y: 350,
    });
  });
});

describe("anchorCenter", () => {
  const page = { width: 600, height: 800 };
  const bounds = { width: 100, height: 50 };

  it.each([
    ["top-left", 86, 739],
    ["top", 300, 739],
    ["top-right", 514, 739],
    ["left", 86, 400],
    ["center", 300, 400],
    ["right", 514, 400],
    ["bottom-left", 86, 61],
    ["bottom", 300, 61],
    ["bottom-right", 514, 61],
  ] as const)("%s", (anchor, x, y) => {
    expect(anchorCenter(page, bounds, anchor, 36)).toEqual({ x, y });
  });

  it("centres an axis the copy does not fit on", () => {
    expect(
      anchorCenter(page, { width: 700, height: 50 }, "top-left", 36),
    ).toEqual({ x: 300, y: 739 });
  });
});

describe("tileCenters", () => {
  const content = { width: 200, height: 40 };

  it.each([0, 45, -30, 90])(
    "at %d° every copy overlaps the page and copies never overlap",
    (deg) => {
      const centres = tileCenters(LETTER, content, deg);
      expect(centres.length).toBeGreaterThan(4);
      const b = rotatedBounds(content, deg);
      for (const c of centres) {
        expect(Math.abs(c.x - 306)).toBeLessThan((612 + b.width) / 2);
        expect(Math.abs(c.y - 396)).toBeLessThan((792 + b.height) / 2);
      }
      // In the watermark's own (rotated) frame, two copies are apart by at
      // least a full width along it or a full height across it.
      const t = (deg * Math.PI) / 180;
      for (let i = 0; i < centres.length; i++) {
        for (let j = i + 1; j < centres.length; j++) {
          const dx = centres[j].x - centres[i].x;
          const dy = centres[j].y - centres[i].y;
          const along = Math.abs(dx * Math.cos(t) + dy * Math.sin(t));
          const across = Math.abs(-dx * Math.sin(t) + dy * Math.cos(t));
          expect(
            along >= content.width - 1e-6 || across >= content.height - 1e-6,
          ).toBe(true);
        }
      }
    },
  );

  it("reaches every quarter of the page", () => {
    const centres = tileCenters(LETTER, content, 45);
    const quarter = (c: Point) =>
      `${c.x < 306 ? "L" : "R"}${c.y < 396 ? "B" : "T"}`;
    expect(new Set(centres.map(quarter))).toEqual(
      new Set(["LB", "LT", "RB", "RT"]),
    );
  });

  it("is centred on the page at 0°", () => {
    const centres = tileCenters(LETTER, content, 0);
    expect(centres).toContainEqual({ x: 306, y: 396 });
  });

  it(`never makes more than ${MAX_TILES} copies`, () => {
    const centres = tileCenters(
      { width: 14400, height: 14400 },
      { width: 4, height: 6 },
      30,
    );
    expect(centres.length).toBeLessThanOrEqual(MAX_TILES);
    expect(centres.length).toBeGreaterThan(MAX_TILES / 4);
  });
});

describe("layoutWatermark", () => {
  it("returns nothing for content without area", () => {
    expect(
      layoutWatermark(LETTER, { width: 0, height: 10 }, 0, "center"),
    ).toEqual([]);
    expect(
      layoutWatermark(LETTER, { width: Number.NaN, height: 10 }, 0, "tile"),
    ).toEqual([]);
  });

  it("places one copy for every anchor", () => {
    for (const anchor of ANCHORS) {
      expect(
        layoutWatermark(LETTER, { width: 100, height: 20 }, 0, anchor),
      ).toHaveLength(1);
    }
  });

  it("keeps an anchored copy inside the margins", () => {
    const [m] = layoutWatermark(
      LETTER,
      { width: 100, height: 20 },
      0,
      "top-right",
    );
    expect(round(applyToPoint(m, { x: 100, y: 20 }))).toEqual({
      x: 576,
      y: 756,
    });
  });

  it("places many copies when tiling", () => {
    const tiles = layoutWatermark(
      LETTER,
      { width: 100, height: 20 },
      45,
      "tile",
    );
    expect(tiles.length).toBeGreaterThan(5);
  });
});
