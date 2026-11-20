import { describe, expect, it } from "vitest";
import { fakeMetrics } from "../test-utils/fake-metrics";
import type { HighlightObject, InkObject, TextObject } from "./model";
import { localBounds } from "./object-bounds";

const frame = { id: "o", x: 0, y: 0, rotation: 0 } as const;

describe("localBounds", () => {
  it("uses width and height for boxes", () => {
    const box: HighlightObject = {
      ...frame,
      kind: "highlight",
      width: 40,
      height: 15,
      color: { r: 255, g: 255, b: 0 },
    };
    expect(localBounds(box, fakeMetrics)).toEqual({
      x: 0,
      y: 0,
      width: 40,
      height: 15,
    });
  });

  it("uses the laid-out block for text", () => {
    const text: TextObject = {
      ...frame,
      kind: "text",
      text: "abcd\nab",
      font: "sans",
      fontSize: 10,
      color: { r: 0, g: 0, b: 0 },
    };
    // widest line 4 chars * 5pt; baselines 8 and 20, plus descent 2
    expect(localBounds(text, fakeMetrics)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 22,
    });
  });

  it("pads ink by half the pen width and allows negative coordinates", () => {
    const ink: InkObject = {
      ...frame,
      kind: "ink",
      points: [
        { x: 0, y: 0 },
        { x: -10, y: 5 },
        { x: 20, y: -4 },
      ],
      color: { r: 0, g: 0, b: 0 },
      strokeWidth: 2,
    };
    expect(localBounds(ink, fakeMetrics)).toEqual({
      x: -11,
      y: -5,
      width: 32,
      height: 11,
    });
  });
});
