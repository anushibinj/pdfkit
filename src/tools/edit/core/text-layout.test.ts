import { describe, expect, it } from "vitest";
import { fakeMetrics } from "../test-utils/fake-metrics";
import {
  LINE_HEIGHT,
  layoutText,
  lineWidth,
  normalizeTextInput,
  stripUnsupported,
} from "./text-layout";

describe("normalizeTextInput", () => {
  it("unifies line breaks and expands tabs", () => {
    expect(normalizeTextInput("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeTextInput("x\ty")).toBe("x    y");
  });
});

describe("lineWidth", () => {
  it("sums advances and scales them to the font size", () => {
    const m = fakeMetrics.metrics("sans");
    expect(lineWidth("abcd", m, 10)).toBe(20); // 4 * 500/1000 * 10
    expect(lineWidth("", m, 10)).toBe(0);
  });

  it("counts unwritable characters as zero width", () => {
    expect(lineWidth("a€b", fakeMetrics.metrics("sans"), 10)).toBe(10);
  });
});

describe("layoutText", () => {
  it("puts the first baseline one ascent below the top", () => {
    const layout = layoutText("Hi", "sans", 10, fakeMetrics);
    expect(layout.lines).toEqual(["Hi"]);
    expect(layout.baselines).toEqual([8]);
    expect(layout.width).toBe(10);
    expect(layout.height).toBe(10); // ascent 8 + descent 2
  });

  it("stacks lines LINE_HEIGHT apart and uses the widest line", () => {
    const layout = layoutText("a\nlonger\n", "sans", 10, fakeMetrics);
    expect(layout.lines).toEqual(["a", "longer", ""]);
    expect(layout.baselines).toEqual([
      8,
      8 + LINE_HEIGHT * 10,
      8 + 2 * LINE_HEIGHT * 10,
    ]);
    expect(layout.width).toBe(30);
    expect(layout.height).toBeCloseTo(8 + 24 + 2);
  });

  it("handles empty text as one empty line", () => {
    const layout = layoutText("", "mono", 12, fakeMetrics);
    expect(layout.lines).toEqual([""]);
    expect(layout.width).toBe(0);
  });
});

describe("stripUnsupported", () => {
  it("keeps writable characters and line breaks", () => {
    expect(stripUnsupported("ab\ncd", "sans", fakeMetrics)).toEqual({
      text: "ab\ncd",
      removed: [],
    });
  });

  it("removes each unwritable character and lists it once", () => {
    expect(stripUnsupported("₹5 ₹6 😀", "sans", fakeMetrics)).toEqual({
      text: "5 6 ",
      removed: ["₹", "😀"],
    });
  });
});
