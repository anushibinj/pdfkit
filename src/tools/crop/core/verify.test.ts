import { describe, expect, it } from "vitest";
import type { Matrix } from "@/lib/geometry/affine";
import {
  ADVANCE_TOLERANCE,
  BLOCK_SIZE,
  MAX_BLOCK_DIFFERENCE,
  findMissingCharacters,
  isInside,
  textBlockMask,
  verifyPage,
  worstNonTextBlock,
  type PageChar,
} from "./verify";

const crop = { left: 0, bottom: 0, right: 100, top: 100 };

/** A character with origin (x, y) and a 5 x 10 box above it. */
function char(c: string, x: number, y: number): PageChar {
  return {
    unicode: c.charCodeAt(0),
    x,
    y,
    box: { left: x, bottom: y, right: x + 5, top: y + 10 },
  };
}

/** Pixels of a w x h white bitmap. */
function white(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h * 4).fill(255);
}

/** Paint one pixel black. */
function blacken(px: Uint8Array, w: number, x: number, y: number) {
  const o = (y * w + x) * 4;
  px[o] = px[o + 1] = px[o + 2] = 0;
}

describe("isInside", () => {
  it("includes the edges", () => {
    expect(isInside(crop, crop)).toBe(true);
    expect(isInside({ ...crop, right: 100.1 }, crop)).toBe(false);
  });
});

describe("findMissingCharacters", () => {
  it("matches characters by code point, baseline and nearby x", () => {
    const before = [char("a", 10, 50), char("b", 20, 50), char("a", 30, 50)];
    const after = [
      char("a", 30.03, 50),
      char("b", 20, 50.01),
      char("a", 10, 50),
    ];
    expect(findMissingCharacters(before, after, crop, 0.05)).toEqual([]);
  });

  it("matches rotated characters that drifted along y within tolerance", () => {
    // Rotated text (e.g. 90 degrees): fractional glyph width drift occurs along y.
    const before = [char("a", 50, 20), char("b", 50, 40)];
    const after = [char("a", 50, 20.03), char("b", 50.01, 40.02)];
    expect(findMissingCharacters(before, after, crop, 0.05)).toEqual([]);
  });

  it("reports characters that vanished, moved too far or changed", () => {
    const before = [char("a", 10, 50), char("b", 20, 50), char("c", 40, 50)];
    const after = [char("a", 10.2, 50), char("b", 20, 50.5), char("x", 40, 50)];
    expect(findMissingCharacters(before, after, crop, 0.1)).toEqual(before);
  });

  it("uses each character of the result only once", () => {
    const before = [char("a", 10, 50), char("a", 10, 50)];
    expect(
      findMissingCharacters(before, [char("a", 10, 50)], crop, 0.05),
    ).toHaveLength(1);
  });

  it("ignores characters not entirely inside the crop area", () => {
    const before = [char("a", -2, 50), char("b", 98, 50)];
    expect(findMissingCharacters(before, [], crop, 0.05)).toEqual([]);
  });
});

describe("textBlockMask", () => {
  it("marks the blocks a box touches, with a margin", () => {
    const identity: Matrix = [1, 0, 0, 1, 0, 0];
    const mask = textBlockMask(
      [{ left: 9, bottom: 9, right: 14, top: 14 }],
      identity,
      32,
      32,
      0,
    );
    // Blocks of 8: x 9..14 and y 9..14 are block (1, 1) only.
    expect(Array.from(mask)).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const wide = textBlockMask(
      [{ left: 9, bottom: 9, right: 14, top: 14 }],
      identity,
      32,
      32,
      2,
    );
    // With 2 px either side it spans pixels 7..16: blocks 0..2 on both axes.
    expect(wide.reduce((s, v) => s + v, 0)).toBe(9);
  });

  it("maps boxes through the transform and clips to the bitmap", () => {
    // y flipped (user y up, pixels y down) and scaled by 2.
    const toPixel: Matrix = [2, 0, 0, -2, 0, 32];
    const mask = textBlockMask(
      [{ left: 0, bottom: 12, right: 3, top: 16 }],
      toPixel,
      32,
      32,
      0,
    );
    expect(mask[0]).toBe(1);
    const off = textBlockMask(
      [{ left: -50, bottom: -50, right: -40, top: -40 }],
      toPixel,
      32,
      32,
      0,
    );
    expect(off.every((v) => v === 0)).toBe(true);
  });
});

describe("worstNonTextBlock", () => {
  it("measures the mean difference of the worst unmasked block", () => {
    const a = white(16, 8);
    const b = white(16, 8);
    blacken(b, 16, 12, 3); // in the second block
    const none = new Uint8Array(2);
    expect(worstNonTextBlock(a, b, 16, 8, none)).toBeCloseTo(
      255 / (BLOCK_SIZE * BLOCK_SIZE),
    );
    expect(worstNonTextBlock(a, b, 16, 8, Uint8Array.of(0, 1))).toBe(0);
  });

  it("handles partial blocks at the edges", () => {
    const a = white(10, 3);
    const b = white(10, 3);
    blacken(b, 10, 9, 2);
    // The last block is 2 x 3 pixels.
    expect(worstNonTextBlock(a, b, 10, 3, new Uint8Array(2))).toBeCloseTo(
      255 / 6,
    );
  });
});

describe("verifyPage", () => {
  const base = {
    crop,
    width: 16,
    height: 16,
    toPixel: [1, 0, 0, -1, 0, 16] as Matrix,
    maxTextShift: 0,
    scale: 1,
  };

  it("passes identical pages", () => {
    const chars = [char("a", 2, 2)];
    expect(
      verifyPage({
        ...base,
        before: { chars, pixels: white(16, 16) },
        after: { chars, pixels: white(16, 16) },
      }),
    ).toBeNull();
  });

  it("fails on a missing character, naming it", () => {
    const failure = verifyPage({
      ...base,
      before: { chars: [char("Q", 2, 2)], pixels: white(16, 16) },
      after: { chars: [], pixels: white(16, 16) },
    });
    expect(failure).toEqual({
      kind: "text",
      message: '1 character inside the crop area changed ("Q")',
    });
  });

  it("allows text to move by the module's bound", () => {
    const failure = verifyPage({
      ...base,
      maxTextShift: 0.3,
      before: { chars: [char("a", 2, 2)], pixels: white(16, 16) },
      after: {
        chars: [char("a", 2 + 0.3 + ADVANCE_TOLERANCE / 2, 2)],
        pixels: white(16, 16),
      },
    });
    expect(failure).toBeNull();
  });

  it("fails when graphics away from text change", () => {
    const after = white(16, 16);
    for (let y = 8; y < 16; y++)
      for (let x = 8; x < 16; x++) blacken(after, 16, x, y);
    const failure = verifyPage({
      ...base,
      before: { chars: [], pixels: white(16, 16) },
      after: { chars: [], pixels: after },
    });
    expect(failure?.kind).toBe("graphics");
    expect(255).toBeGreaterThan(MAX_BLOCK_DIFFERENCE);
  });
});
