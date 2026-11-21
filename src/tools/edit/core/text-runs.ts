import { applyToPoint, invert, type Matrix } from "@/lib/affine";
import type { FontFamily, PageBox, Rgb } from "./model";
import type { FontMetricsSource } from "./text-layout";

/** What PDFium reports about the font of a text object. */
export interface FontDescription {
  /** PostScript name, possibly with a subset tag: "BAAAAA+DejaVuSans-Bold". */
  baseName: string;
  /** Family name, e.g. "DejaVu Sans" (may be empty). */
  family: string;
  /** PDF font descriptor flags (bit 1 fixed pitch, 2 serif, 7 italic, 19 bold). */
  flags: number;
  /** Font weight, 100-900, or a value <= 0 when unknown. */
  weight: number;
  /** Italic angle in degrees (0 for upright fonts). */
  italicAngle: number;
  /** Whether the font program is embedded in the file. */
  embedded: boolean;
}

/** One PDF text object, as read from a page (see `readPageText`). */
export interface TextFragment {
  /** Position of the object in the page's object list. */
  index: number;
  /** Its text, including spaces PDFium inferred from gaps. */
  text: string;
  /** Identifies the font: equal keys mean the same font in the file. */
  fontKey: number;
  font: FontDescription;
  /** Font size from the text state (`Tf`), before the matrix. */
  fontSize: number;
  /** Text matrix in user space (the page transform already applied). */
  matrix: Matrix;
  /** Area the glyphs cover, in user space. */
  bounds: PageBox;
  color: Rgb;
  /** PDF text render mode (0 fill, 1 stroke, 2 fill + stroke, ...). */
  renderMode: number;
}

/** One character of PDFium's text page (see `PdfiumPageText.read`). */
export interface PageChar {
  char: string;
  /** PDFium inferred it (a space for a gap, a line break); nothing is drawn. */
  generated: boolean;
  /** Font of the text object that draws it. */
  fontKey: number;
  /** Where its glyph is placed, in user space. */
  x: number;
  y: number;
}

/** What a page's text looks like before any edit. */
export interface PageTextSnapshot {
  /** Visible text objects, in content order. */
  fragments: TextFragment[];
  /** For each font, the characters it really draws on this page. */
  observed: ReadonlyMap<number, ReadonlySet<string>>;
}

/** A visual style close enough to pick a substitute standard font. */
export interface FontStyle {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

/**
 * One editable line: adjacent fragments of the same style on the same
 * baseline, merged. PDF producers often split a line into pieces (Chrome
 * splits around kerned pairs: "T" + "otal amount"), which a person sees,
 * and wants to edit, as one line.
 */
export interface TextRun {
  /** Stable id: the fragments' object indices joined by "-". */
  id: string;
  /** Object indices of the fragments, in order. */
  indices: number[];
  text: string;
  /** Union of the fragments' bounds, in user space. */
  box: PageBox;
  /**
   * The line's own axes in user space, with unit scale: origin at the
   * start of the baseline, x along the baseline, y towards the top of the
   * glyphs. Maps line coordinates in points to user space.
   */
  baseline: Matrix;
  /** Length of the line along its baseline, in points. */
  width: number;
  /** Size as it appears on the page, in points. */
  fontSize: number;
  style: FontStyle;
  color: Rgb;
}

/** Flag bits of a PDF font descriptor (PDF 32000-1, table 123). */
const FLAG_FIXED_PITCH = 1 << 0;
const FLAG_SERIF = 1 << 1;
const FLAG_ITALIC = 1 << 6;
const FLAG_FORCE_BOLD = 1 << 18;

/** Standard 14 text fonts PDFium can use without embedding anything. */
const STANDARD_TEXT_FONTS = new Set([
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
]);

/**
 * Remove a subset tag: embedded subset fonts are named with six capital
 * letters and a plus sign in front ("ABCDEF+Calibri" is a subset of
 * Calibri).
 *
 * @param name A PostScript font name.
 * @returns The name without the tag.
 */
export function stripSubsetTag(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

/**
 * Size of text as it appears on the page.
 *
 * The `Tf` size is scaled by the text matrix, which also carries the page
 * transform: Chrome writes 14 px text as size 14 with a 0.75 scale (pixels
 * to points), so it appears 10.5 pt tall; Word often writes size 1 with the
 * real size in the matrix. The vertical scale is the length of the matrix's
 * second column, (c, d).
 *
 * @param fontSize The `Tf` size.
 * @param matrix The text object's matrix.
 * @returns The apparent size in points.
 */
export function effectiveFontSize(fontSize: number, matrix: Matrix): number {
  return fontSize * Math.hypot(matrix[2], matrix[3]);
}

/**
 * Guess a font's look from its descriptor and name, to pick a standard
 * substitute when the original font cannot write the new text.
 *
 * Descriptor flags are often missing or wrong (Chrome marks every font
 * "symbolic" and nothing else), so the name is checked as well:
 * - monospaced: the fixed-pitch flag, or a name like Courier, Consolas, Mono;
 * - serif: the serif flag, or a name like Times, Georgia, Garamond, Serif
 *   (but not "Sans Serif");
 * - bold: weight 600 or more, the force-bold flag, or Bold/Black/Heavy/Semi
 *   bold/Demi in the name;
 * - italic: a non-zero italic angle, the italic flag, or Italic/Oblique in
 *   the name.
 *
 * @param font The font's description.
 * @returns Family, bold and italic.
 */
export function describeFontStyle(font: FontDescription): FontStyle {
  const name = `${stripSubsetTag(font.baseName)} ${font.family}`;
  const mono =
    (font.flags & FLAG_FIXED_PITCH) !== 0 ||
    /courier|mono|consol|menlo|typewriter|code/i.test(name);
  const serif =
    !/sans/i.test(name) &&
    ((font.flags & FLAG_SERIF) !== 0 ||
      /times|serif|georgia|garamond|cambria|roman|book|minion|palatino|baskerville/i.test(
        name,
      ));
  const bold =
    font.weight >= 600 ||
    (font.flags & FLAG_FORCE_BOLD) !== 0 ||
    /bold|black|heavy|semibold|demi/i.test(name);
  const italic =
    font.italicAngle !== 0 ||
    (font.flags & FLAG_ITALIC) !== 0 ||
    /italic|oblique/i.test(name);
  return { family: mono ? "mono" : serif ? "serif" : "sans", bold, italic };
}

/**
 * The standard 14 font closest to a style, e.g. bold italic serif ->
 * "Times-BoldItalic". Every PDF reader has these built in.
 *
 * @param style Family, bold and italic.
 * @returns A standard font name.
 */
export function standardFontFor(style: FontStyle): string {
  const { family, bold, italic } = style;
  if (family === "serif") {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    return italic ? "Times-Italic" : "Times-Roman";
  }
  const base = family === "mono" ? "Courier" : "Helvetica";
  if (bold && italic) return `${base}-BoldOblique`;
  if (bold) return `${base}-Bold`;
  return italic ? `${base}-Oblique` : base;
}

/**
 * Decide whether new text can be written with a line's original font.
 *
 * Embedded fonts are usually subsets: they contain only the glyphs the
 * document uses, and PDFium silently drops characters that have no glyph
 * (verified: "1300 Qollars" came out as "100 ollars"). So a character is
 * accepted only if the font demonstrably has it:
 * - a standard font that is not embedded (Helvetica, Times...) is drawn by
 *   the reader in full, so every character its WinAnsi encoding has works;
 * - any other font must have shown the character on the page already
 *   (`observed`, which excludes spaces PDFium only inferred from gaps).
 *
 * @param text The new text.
 * @param font The original font.
 * @param observed Characters this font really draws on the page.
 * @param metrics Standard font metrics (for WinAnsi coverage).
 * @returns `true` if the original font can write every character.
 */
export function originalFontCanWrite(
  text: string,
  font: FontDescription,
  observed: ReadonlySet<string>,
  metrics: FontMetricsSource,
): boolean {
  if (
    !font.embedded &&
    STANDARD_TEXT_FONTS.has(stripSubsetTag(font.baseName))
  ) {
    const winAnsi = metrics.metrics("sans");
    for (const char of text)
      if (winAnsi.advance(char) === undefined) return false;
    return true;
  }
  for (const char of text) if (!observed.has(char)) return false;
  return true;
}

/**
 * Work out which characters each font demonstrably has a glyph for.
 *
 * A character counts only if a font draws it on its own glyph:
 * - generated characters (spaces PDFium inferred from gaps, line breaks)
 *   are skipped: nothing was drawn;
 * - ligature parts are skipped. PDFium splits one "fl" glyph into "f" and
 *   "l", both placed at the glyph's single origin. The font may have no
 *   separate "l" glyph at all (verified with a Chromium PDF in DejaVu
 *   Serif, where writing "l" produced a .notdef box), so a character that
 *   shares its origin with a neighbour drawn by the same font is not
 *   evidence of anything.
 *
 * @param chars The page's characters in text-page order.
 * @returns Characters per font key.
 */
export function observedCharacters(
  chars: readonly PageChar[],
): Map<number, Set<string>> {
  const samePlace = (a: PageChar | undefined, b: PageChar) =>
    a !== undefined &&
    !a.generated &&
    a.fontKey === b.fontKey &&
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01;
  const observed = new Map<number, Set<string>>();
  chars.forEach((c, i) => {
    if (c.generated || c.char === "") return;
    if (samePlace(chars[i - 1], c) || samePlace(chars[i + 1], c)) return;
    let set = observed.get(c.fontKey);
    if (!set) observed.set(c.fontKey, (set = new Set()));
    set.add(c.char);
  });
  return observed;
}

/**
 * Whether two colours are the same.
 *
 * @param a A colour.
 * @param b Another colour.
 * @returns `true` if all channels match.
 */
function sameColor(a: Rgb, b: Rgb): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * Decide whether `next` continues the line that `prev` belongs to, and if
 * so whether a space must be inserted between their texts.
 *
 * Both must share font, size, colour, render mode and orientation (the
 * linear part of the matrix). Then `next`'s origin is mapped into `prev`'s
 * text space (x along the baseline, y across it, scaled by the matrix):
 * - it must sit on the same baseline: |y| within a quarter of the font size;
 * - it must start after `prev` starts, and no more than one font size after
 *   `prev`'s right edge (wider gaps are columns or tab stops, kept apart).
 *   A small overlap is normal: kerning pulls the next glyph back.
 * A gap wider than a fifth of the font size reads as a word break, so a
 * space is inserted unless one of the texts already has one there.
 *
 * @param prev The last fragment of the line so far.
 * @param next The candidate fragment.
 * @returns `null` if `next` starts a new line, else whether to add a space.
 */
export function continuesLine(
  prev: TextFragment,
  next: TextFragment,
): { space: boolean } | null {
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-3;
  if (
    prev.fontKey !== next.fontKey ||
    Math.abs(prev.fontSize - next.fontSize) > 0.01 ||
    !sameColor(prev.color, next.color) ||
    prev.renderMode !== next.renderMode ||
    ![0, 1, 2, 3].every((i) => close(prev.matrix[i], next.matrix[i]))
  ) {
    return null;
  }
  // Text space of `prev`, scaled so that one unit is one font size.
  const toText = invert(prev.matrix);
  const size = prev.fontSize;
  const origin = applyToPoint(toText, { x: next.matrix[4], y: next.matrix[5] });
  if (Math.abs(origin.y) > 0.25 * size || origin.x <= 0) return null;
  // Where `prev`'s glyphs end along the baseline: its rightmost bound.
  const { left, bottom, right, top } = prev.bounds;
  const end = Math.max(
    ...[
      { x: left, y: bottom },
      { x: right, y: bottom },
      { x: left, y: top },
      { x: right, y: top },
    ].map((p) => applyToPoint(toText, p).x),
  );
  const gap = origin.x - end;
  if (gap > size) return null;
  const hasSpace = /\s$/.test(prev.text) || /^\s/.test(next.text);
  return { space: gap > 0.2 * size && !hasSpace };
}

/**
 * Merge fragments into editable lines, in content order.
 *
 * Content order is the order the producer drew the text, which for
 * practically all PDFs is reading order within a line, so only neighbours
 * in that order are merged (see {@link continuesLine}).
 *
 * @param fragments The page's text fragments, in object order.
 * @returns The lines.
 */
export function groupFragments(fragments: readonly TextFragment[]): TextRun[] {
  const groups: { parts: TextFragment[]; text: string }[] = [];
  for (const fragment of fragments) {
    const group = groups[groups.length - 1];
    const join =
      group && continuesLine(group.parts[group.parts.length - 1], fragment);
    if (group && join) {
      group.parts.push(fragment);
      group.text += (join.space ? " " : "") + fragment.text;
    } else {
      groups.push({ parts: [fragment], text: fragment.text });
    }
  }
  return groups.map(({ parts, text }) => {
    const first = parts[0];
    const baseline = unitFrame(first.matrix);
    // The line's extent along the baseline: the farthest corner of any
    // fragment's bounds, measured in the line's own axes.
    const toLine = invert(baseline);
    const width = Math.max(
      0,
      ...parts.flatMap(({ bounds: { left, bottom, right, top } }) =>
        [
          { x: left, y: bottom },
          { x: right, y: bottom },
          { x: left, y: top },
          { x: right, y: top },
        ].map((p) => applyToPoint(toLine, p).x),
      ),
    );
    return {
      id: parts.map((p) => p.index).join("-"),
      indices: parts.map((p) => p.index),
      text,
      box: {
        left: Math.min(...parts.map((p) => p.bounds.left)),
        bottom: Math.min(...parts.map((p) => p.bounds.bottom)),
        right: Math.max(...parts.map((p) => p.bounds.right)),
        top: Math.max(...parts.map((p) => p.bounds.top)),
      },
      baseline,
      width,
      fontSize: effectiveFontSize(first.fontSize, first.matrix),
      style: describeFontStyle(first.font),
      color: first.color,
    };
  });
}

/**
 * A text matrix with its scale removed: the directions of its axes and its
 * origin, so that one unit is one point along each axis.
 *
 * @param matrix A text object's matrix.
 * @returns The same axes at unit length (a zero axis is left as is).
 */
export function unitFrame(matrix: Matrix): Matrix {
  const [a, b, c, d, e, f] = matrix;
  const sx = Math.hypot(a, b) || 1;
  const sy = Math.hypot(c, d) || 1;
  return [a / sx, b / sx, c / sy, d / sy, e, f];
}
