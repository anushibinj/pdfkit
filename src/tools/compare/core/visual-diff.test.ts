import { describe, expect, it } from "vitest";
import {
  CpuPixelDiffer,
  DIFF_REGION_CELL_SIZE,
  extractDiffRegions,
} from "./visual-diff";

function solidRgba(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = 255;
  }
  return buf;
}

function paintBox(
  buf: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number],
) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const o = (y * width + x) * 4;
      buf[o] = rgb[0];
      buf[o + 1] = rgb[1];
      buf[o + 2] = rgb[2];
    }
  }
}

describe("visual-diff", () => {
  it("reports zero difference for identical bitmaps", () => {
    const a = solidRgba(32, 32, 255, 255, 255);
    const b = solidRgba(32, 32, 255, 255, 255);
    const differ = new CpuPixelDiffer();
    const res = differ.compute({
      pairIndex: 0,
      leftPixels: a,
      leftWidth: 32,
      leftHeight: 32,
      rightPixels: b,
      rightWidth: 32,
      rightHeight: 32,
    });

    expect(res.summary.changedPixels).toBe(0);
    expect(res.summary.percentChanged).toBe(0);
    expect(res.summary.regions).toEqual([]);
    expect(res.summary.sizeMismatch).toBe(false);
  });

  it("flags a moved logo in distinct red (removed) and green (added) regions", () => {
    const left = solidRgba(64, 64, 255, 255, 255);
    const right = solidRgba(64, 64, 255, 255, 255);

    paintBox(left, 64, 4, 4, 12, 12, [0, 0, 0]);
    paintBox(right, 64, 44, 44, 12, 12, [0, 0, 0]);

    const differ = new CpuPixelDiffer();
    const res = differ.compute({
      pairIndex: 0,
      leftPixels: left,
      leftWidth: 64,
      leftHeight: 64,
      rightPixels: right,
      rightWidth: 64,
      rightHeight: 64,
    });

    expect(res.summary.changedPixels).toBe(2 * 12 * 12);
    expect(res.summary.regions.length).toBe(2);

    const removedOff = (8 * 64 + 8) * 4;
    expect(res.pixels[removedOff]).toBeGreaterThan(res.pixels[removedOff + 1]);

    const addedOff = (48 * 64 + 48) * 4;
    expect(res.pixels[addedOff + 1]).toBeGreaterThan(res.pixels[addedOff]);
  });

  it("highlights equal-luminance colour shifts in magenta", () => {
    // luma(0, 0, 255) = 29.07 and luma(97, 0, 0) = 29.00 (equal luminance)
    const left = solidRgba(16, 16, 0, 0, 255);
    const right = solidRgba(16, 16, 97, 0, 0);
    const differ = new CpuPixelDiffer();
    const res = differ.compute({
      pairIndex: 0,
      leftPixels: left,
      leftWidth: 16,
      leftHeight: 16,
      rightPixels: right,
      rightWidth: 16,
      rightHeight: 16,
    });
    expect(res.summary.changedPixels).toBe(256);
    expect(res.pixels[0]).toBeGreaterThan(res.pixels[1]);
    expect(res.pixels[2]).toBeGreaterThan(res.pixels[1]);
  });

  it("aligns pages of different sizes top-left onto max dimensions", () => {
    const left = solidRgba(32, 32, 255, 255, 255);
    const right = solidRgba(48, 32, 255, 255, 255);
    paintBox(right, 48, 36, 4, 8, 8, [0, 0, 0]);

    const res = new CpuPixelDiffer().compute({
      pairIndex: 1,
      leftPixels: left,
      leftWidth: 32,
      leftHeight: 32,
      rightPixels: right,
      rightWidth: 48,
      rightHeight: 32,
    });

    expect(res.summary.sizeMismatch).toBe(true);
    expect(res.summary.width).toBe(48);
    expect(res.summary.height).toBe(32);
    expect(res.summary.changedPixels).toBe(64);
  });

  it("extracts connected regions cleanly with extractDiffRegions", () => {
    const counts = new Uint32Array(4 * 4);
    counts[0] = 10;
    counts[5] = 12;
    counts[15] = 8;
    const regions = extractDiffRegions(
      counts,
      4,
      4,
      64,
      64,
      DIFF_REGION_CELL_SIZE,
    );
    expect(regions).toHaveLength(2);
    expect(regions[0].pixelCount).toBe(22);
    expect(regions[1].pixelCount).toBe(8);
  });
});
