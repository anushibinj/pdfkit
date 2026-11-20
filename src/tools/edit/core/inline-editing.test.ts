import { describe, expect, it } from "vitest";
import { fakeMetrics } from "../test-utils/fake-metrics";
import { applyToPoint } from "./affine";
import {
  RUN_EDITOR_LINE_HEIGHT,
  SCREEN_FONT_METRICS,
  cssBaselineOffset,
  runEditorBox,
  runHitArea,
  runToView,
  textObjectEditorBox,
} from "./inline-editing";
import type { TextObject } from "./model";
import { LINE_HEIGHT } from "./text-layout";
import type { TextRun } from "./text-runs";

/** A 10 pt line from x 50 to 150 on the baseline y = 700 (user space). */
const run: TextRun = {
  id: "3",
  indices: [3],
  text: "Hello",
  box: { left: 50, bottom: 698, right: 150, top: 708 },
  baseline: [1, 0, 0, 1, 50, 700],
  width: 100,
  fontSize: 10,
  style: { family: "sans", bold: false, italic: false },
  color: { r: 0, g: 0, b: 0 },
};
const page = { left: 0, bottom: 0, right: 600, top: 800 };
const round = (p: { x: number; y: number }) => ({
  x: Math.round(p.x * 1000) / 1000 + 0,
  y: Math.round(p.y * 1000) / 1000 + 0,
});

describe("cssBaselineOffset", () => {
  it("is half the leading plus the ascent", () => {
    const { ascent, descent } = SCREEN_FONT_METRICS.sans;
    // 20 px font in a 30 px line
    expect(cssBaselineOffset("sans", 20, 30)).toBeCloseTo(
      (30 - (ascent + descent) * 20) / 2 + ascent * 20,
    );
  });
});

describe("runToView", () => {
  it("puts the baseline start on screen and points y down", () => {
    const m = runToView(run, page, 0);
    expect(round(applyToPoint(m, { x: 0, y: 0 }))).toEqual({ x: 50, y: 100 });
    // one point down in line space is one point down on screen
    expect(round(applyToPoint(m, { x: 0, y: 1 }))).toEqual({ x: 50, y: 101 });
  });

  it("follows a page turned a quarter clockwise", () => {
    const m = runToView(run, page, 1);
    // near the top-left of the page, so near the top-right once turned:
    // view x = 800 - 100, view y = 50
    expect(round(applyToPoint(m, { x: 0, y: 0 }))).toEqual({ x: 700, y: 50 });
    // along the baseline now runs down the screen
    expect(round(applyToPoint(m, { x: 10, y: 0 }))).toEqual({ x: 700, y: 60 });
  });
});

describe("runHitArea", () => {
  it("covers the glyph bounds in the line's y-down space", () => {
    expect(runHitArea(run)).toEqual({ x: 0, y: -8, width: 100, height: 10 });
  });

  it("falls back to one font size above the baseline for flat bounds", () => {
    const flat = { ...run, box: { ...run.box, bottom: 700, top: 700 } };
    expect(runHitArea(flat)).toEqual({ x: 0, y: -10, width: 100, height: 10 });
  });
});

describe("runEditorBox", () => {
  it("sits the field's baseline on the line's baseline, with room to type", () => {
    const box = runEditorBox(run);
    const height = 10 * RUN_EDITOR_LINE_HEIGHT;
    expect(box.height).toBe(height);
    expect(box.y + cssBaselineOffset("sans", 10, height)).toBeCloseTo(0);
    expect(box.width).toBe(150);
    expect(runEditorBox({ ...run, width: 4 }).width).toBe(44);
  });
});

describe("textObjectEditorBox", () => {
  it("aligns the first baseline with the preview's and fits every line", () => {
    const object: TextObject = {
      id: "t",
      kind: "text",
      x: 0,
      y: 0,
      rotation: 0,
      text: "abcd\nab",
      font: "serif",
      fontSize: 10,
      color: { r: 0, g: 0, b: 0 },
    };
    const box = textObjectEditorBox(object, fakeMetrics);
    // fake metrics: ascent 800 -> first preview baseline at 8
    expect(
      box.y + cssBaselineOffset("serif", 10, LINE_HEIGHT * 10),
    ).toBeCloseTo(8);
    expect(box.height).toBeCloseTo(2 * LINE_HEIGHT * 10);
    expect(box.width).toBe(80); // max(20 + 40, 80)
  });
});
