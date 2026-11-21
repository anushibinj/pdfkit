import { describe, expect, it } from "vitest";
import { TEXT_PADDING_RATIO, layoutTextBlock } from "./text-block";

const SIZE = 20;
const PAD = TEXT_PADDING_RATIO * SIZE; // 1

describe("layoutTextBlock", () => {
  it("wraps a single line's ink in padding, starting at (0, 0)", () => {
    // ink from x 2..102, y -4..14 (a descender below the baseline)
    const block = layoutTextBlock(
      [{ left: 2, bottom: -4, right: 102, top: 14 }],
      SIZE,
    );
    expect(block.size).toEqual({ width: 100 + 2 * PAD, height: 18 + 2 * PAD });
    // the ink's left edge (origin.x + 2) and bottom (origin.y - 4) sit at PAD
    expect(block.origins).toEqual([{ x: PAD - 2, y: PAD + 4 }]);
  });

  it("centres lines on each other and stacks them by the line height", () => {
    const block = layoutTextBlock(
      [
        { left: 0, bottom: 0, right: 100, top: 14 },
        { left: 0, bottom: 0, right: 40, top: 14 },
      ],
      SIZE,
    );
    const step = 1.2 * SIZE; // 24
    // block ink: y from -24 (second baseline) to 14
    expect(block.size).toEqual({ width: 100 + 2 * PAD, height: 38 + 2 * PAD });
    expect(block.origins).toEqual([
      { x: PAD, y: PAD + step },
      { x: PAD + 30, y: PAD },
    ]);
  });

  it("keeps blank lines as gaps", () => {
    const ink = { left: 0, bottom: 0, right: 10, top: 10 };
    const block = layoutTextBlock([ink, null, ink], SIZE);
    expect(block.origins[1]).toBeNull();
    // two line steps between first and last baseline
    expect(block.origins[0]!.y - block.origins[2]!.y).toBeCloseTo(48, 9);
  });

  it("returns an empty block when every line is blank", () => {
    expect(layoutTextBlock([null, null], SIZE)).toEqual({
      size: { width: 0, height: 0 },
      origins: [null, null],
    });
  });
});
