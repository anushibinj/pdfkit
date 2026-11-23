import { describe, expect, it } from "vitest";
import { planStamps, sizeKey } from "./stamp-plan";

const A4 = { width: 595.2756, height: 841.8898 };
const LANDSCAPE = { width: 841.8898, height: 595.2756 };

describe("sizeKey", () => {
  it("rounds to 1/100 pt", () => {
    expect(sizeKey(A4)).toBe("595.28x841.89");
    expect(sizeKey({ width: 595.2799, height: 841.8901 })).toBe(sizeKey(A4));
    expect(sizeKey(LANDSCAPE)).not.toBe(sizeKey(A4));
  });
});

describe("planStamps", () => {
  it("shares one stamp page between pages of the same size", () => {
    expect(
      planStamps([
        { index: 0, size: A4 },
        { index: 2, size: LANDSCAPE },
        { index: 3, size: { width: 595.28, height: 841.89 } },
        { index: 7, size: LANDSCAPE },
      ]),
    ).toEqual({
      stamps: [A4, LANDSCAPE],
      to: [0, 2, 3, 7],
      from: [0, 1, 0, 1],
    });
  });

  it("plans nothing for no pages", () => {
    expect(planStamps([])).toEqual({ stamps: [], to: [], from: [] });
  });
});
