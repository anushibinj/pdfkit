import { applyToPoint, compose, invert, type Matrix } from "@/lib/affine";
import type { FontFamily, PageBox, QuarterTurns, TextObject } from "./model";
import { userToView } from "./page-geometry";
import { LINE_HEIGHT, layoutText, type FontMetricsSource } from "./text-layout";
import type { TextRun } from "./text-runs";

/** A rectangle in some local space (x right, y down). */
export interface LocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Vertical metrics of the screen fonts the editor types with, in em:
 * Arial / Liberation Sans, Times New Roman / Liberation Serif, Courier New
 * / Liberation Mono (each pair shares its metrics by design). Used to put
 * the baseline of an HTML text field exactly on the PDF baseline.
 */
export const SCREEN_FONT_METRICS: Record<
  FontFamily,
  { ascent: number; descent: number }
> = {
  sans: { ascent: 0.905, descent: 0.212 },
  serif: { ascent: 0.891, descent: 0.216 },
  mono: { ascent: 0.833, descent: 0.3 },
};

/** Line height of the inline field for an existing line, in em. */
export const RUN_EDITOR_LINE_HEIGHT = 1.25;

/** Turns a y-up frame into a y-down one (HTML and SVG content grow down). */
const FLIP_Y: Matrix = [1, 0, 0, -1, 0, 0];

/**
 * Where the baseline of a single-line CSS line box sits, from its top.
 *
 * CSS centres the font's content area (ascent + descent) in the line box,
 * splitting the remaining "leading" equally above and below, so the
 * baseline is half the leading plus the ascent below the top.
 *
 * @param family Font family of the field.
 * @param fontSize Font size in CSS px (points, in the overlay).
 * @param lineHeight Line box height in the same unit.
 * @returns The baseline's distance from the top of the line box.
 */
export function cssBaselineOffset(
  family: FontFamily,
  fontSize: number,
  lineHeight: number,
): number {
  const { ascent, descent } = SCREEN_FONT_METRICS[family];
  return (lineHeight - (ascent + descent) * fontSize) / 2 + ascent * fontSize;
}

/**
 * Transform from a line's own space (origin at the start of the baseline,
 * x along it, y down towards the descenders, in points) to view space.
 *
 * The line's baseline frame maps to user space with y up; flipping y first
 * gives the y-down space HTML and SVG content expect, and `userToView` then
 * places it on the displayed (possibly rotated) page.
 *
 * @param run The line.
 * @param box The page's visible area in user space.
 * @param turns Clockwise display rotation.
 * @returns The line-to-view transform.
 */
export function runToView(
  run: TextRun,
  box: PageBox,
  turns: QuarterTurns,
): Matrix {
  return compose(userToView(box, turns), compose(run.baseline, FLIP_Y));
}

/**
 * The area to click to edit a line, in the line's own y-down space.
 *
 * It is the line's glyph bounds measured along its own axes, so it hugs
 * rotated text too. A line whose bounds are degenerate (zero height) still
 * gets a box one font size tall above the baseline.
 *
 * @param run The line.
 * @returns The rectangle.
 */
export function runHitArea(run: TextRun): LocalRect {
  const toLine = invert(run.baseline);
  const { left, bottom, right, top } = run.box;
  const ys = [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: left, y: top },
    { x: right, y: top },
  ].map((p) => applyToPoint(toLine, p).y);
  // In the line's y-up space the glyphs span [min, max]; flip for y-down.
  let above = Math.max(...ys);
  let below = Math.min(...ys);
  if (above - below < 1e-3) {
    above = run.fontSize;
    below = 0;
  }
  return { x: 0, y: -above, width: run.width, height: above - below };
}

/**
 * Where the inline field for an existing line goes, in the line's own
 * y-down space: its text baseline on the line's baseline, as tall as one
 * line, and wider than the line so there is room to type more.
 *
 * @param run The line.
 * @returns The field's rectangle.
 */
export function runEditorBox(run: TextRun): LocalRect {
  const height = run.fontSize * RUN_EDITOR_LINE_HEIGHT;
  return {
    x: 0,
    y: -cssBaselineOffset(run.style.family, run.fontSize, height),
    width: Math.max(run.width * 1.5, run.width + run.fontSize * 4),
    height,
  };
}

/**
 * Where the inline text area for an added text object goes, in the
 * object's local space (the space its preview is drawn in).
 *
 * The preview puts the first baseline at the font's ascent (see
 * `layoutText`); the text area is shifted so the browser's first baseline
 * lands there too, and its lines are as far apart as the preview's.
 *
 * @param object The text object.
 * @param metrics Font metrics.
 * @returns The text area's rectangle.
 */
export function textObjectEditorBox(
  object: TextObject,
  metrics: FontMetricsSource,
): LocalRect {
  const layout = layoutText(object.text, object.font, object.fontSize, metrics);
  const lineHeight = LINE_HEIGHT * object.fontSize;
  return {
    x: 0,
    y:
      layout.baselines[0] -
      cssBaselineOffset(object.font, object.fontSize, lineHeight),
    width: Math.max(layout.width + object.fontSize * 4, object.fontSize * 8),
    height: layout.lines.length * lineHeight,
  };
}
