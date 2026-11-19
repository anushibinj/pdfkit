import type { FontFamily } from "./model";

/** Glyph measurements of one font, in 1/1000 em (PDF font units). */
export interface FontMetrics {
  /**
   * Horizontal advance of one character.
   *
   * @param char A single Unicode character (one code point).
   * @returns The advance, or `undefined` when the font cannot write it.
   */
  advance(char: string): number | undefined;
  /** Height of the tallest letters above the baseline (positive). */
  ascent: number;
  /** Depth of descenders below the baseline (negative). */
  descent: number;
}

/** Looks up {@link FontMetrics} by family (injected so tests can fake it). */
export interface FontMetricsSource {
  /**
   * @param font A font family.
   * @returns That family's metrics.
   */
  metrics(font: FontFamily): FontMetrics;
}

/** Distance between consecutive baselines, as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;

/** Spaces that replace one tab character (standard fonts have no tab glyph). */
const TAB_AS_SPACES = "    ";

/**
 * Clean up typed or pasted text before it is stored.
 *
 * - Windows (CRLF) and old Mac (CR) line breaks become "\n", the only line
 *   separator the layout understands.
 * - Tabs become four spaces: PDF standard fonts have no tab glyph, so a tab
 *   would otherwise be rejected as an unsupported character.
 *
 * @param text Raw text from a text field.
 * @returns The normalised text.
 */
export function normalizeTextInput(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, TAB_AS_SPACES);
}

/** Where each line of a text object goes, in its local space (points). */
export interface TextLayout {
  /** The lines, in order (an empty text has one empty line). */
  lines: string[];
  /** Local `v` of each line's baseline. */
  baselines: number[];
  /** Width of the widest line. */
  width: number;
  /** From the top of the first line to the bottom of the last line. */
  height: number;
}

/**
 * Measure a line of text with a font's advance widths.
 *
 * Characters the font cannot write add nothing (they are removed before
 * saving anyway, see {@link stripUnsupported}). Kerning is not applied,
 * because PDFium does not kern text objects either; the overlay and the
 * saved PDF therefore agree on every line's width.
 *
 * @param line One line of text (no "\n").
 * @param metrics The font's metrics.
 * @param fontSize Font size in points.
 * @returns The line's width in points.
 */
export function lineWidth(
  line: string,
  metrics: FontMetrics,
  fontSize: number,
): number {
  let units = 0;
  for (const char of line) units += metrics.advance(char) ?? 0;
  return (units * fontSize) / 1000;
}

/**
 * Lay out a (possibly multi-line) text object in its local space.
 *
 * Local space has its origin at the text's top-left corner and `v` growing
 * downwards. The first baseline sits one ascent below the top, so the
 * tallest letters touch v = 0. Each further line is LINE_HEIGHT * fontSize
 * lower. The block ends one descent below the last baseline.
 *
 * The overlay draws SVG `<text>` at exactly these baselines and the PDF
 * writer places PDFium text objects at the same ones, which is what makes
 * the preview line up with the saved file.
 *
 * @param text The text ("\n" separates lines).
 * @param font Font family.
 * @param fontSize Font size in points.
 * @param source Font metrics lookup.
 * @returns Line positions and the block's size.
 */
export function layoutText(
  text: string,
  font: FontFamily,
  fontSize: number,
  source: FontMetricsSource,
): TextLayout {
  const metrics = source.metrics(font);
  const lines = text.split("\n");
  const ascent = (metrics.ascent * fontSize) / 1000;
  const descent = (-metrics.descent * fontSize) / 1000;
  const step = LINE_HEIGHT * fontSize;
  const baselines = lines.map((_, i) => ascent + i * step);
  const width = Math.max(...lines.map((l) => lineWidth(l, metrics, fontSize)));
  const height = baselines[baselines.length - 1] + descent;
  return { lines, baselines, width, height };
}

/**
 * Remove every character the font cannot write.
 *
 * PDFium accepts such characters without complaint but writes them as
 * garbage ("ÿ") into a standard font, so they are dropped up front and the
 * caller can tell the user which ones went. Line breaks are kept: they are
 * layout, not glyphs.
 *
 * @param text Text to check.
 * @param font Font family the text will use.
 * @param source Font metrics lookup.
 * @returns The cleaned text and the distinct characters that were removed,
 *   in order of first appearance.
 */
export function stripUnsupported(
  text: string,
  font: FontFamily,
  source: FontMetricsSource,
): { text: string; removed: string[] } {
  const metrics = source.metrics(font);
  const removed = new Set<string>();
  let kept = "";
  // for...of walks code points, so an emoji (two UTF-16 units) is one char.
  for (const char of text) {
    if (char === "\n" || metrics.advance(char) !== undefined) kept += char;
    else removed.add(char);
  }
  return { text: kept, removed: [...removed] };
}
