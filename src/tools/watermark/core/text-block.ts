import type { Point } from "@/lib/affine";
import type { Size } from "@/lib/pdfium/page-box";
import { LINE_HEIGHT } from "./model";

/**
 * The ink of one line of text, as PDFium measures a text object drawn at
 * the origin: x from the left of the first glyph's ink, y from the baseline
 * (descenders are negative).
 */
export interface LineBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** Space kept around the text's ink, as a multiple of the font size. */
export const TEXT_PADDING_RATIO = 0.05;

/** Where each line goes inside the text block, and the block's size. */
export interface TextBlock {
  /** The block's size, padding included. */
  size: Size;
  /**
   * The origin (baseline start) of each line in block space, or `null` for
   * a blank line, which only takes up its line of height.
   */
  origins: (Point | null)[];
}

/**
 * Lay out the lines of a text watermark as one centred block.
 *
 * Steps, in a space with y pointing up:
 * 1. Baselines: the first line sits at y = 0, each next one is
 *    `LINE_HEIGHT * fontSize` lower. Blank lines take their place in this
 *    sequence, so an empty line between two lines makes a visible gap.
 * 2. Horizontal centring: each line is shifted so the centre of its ink,
 *    (left + right) / 2, lands on the centre of the widest line's ink.
 *    Centring on ink (not on advance widths) keeps a line visually centred
 *    even when its first or last glyph has side bearings.
 * 3. The block's ink box is the union of the lines' ink boxes; the block
 *    is then moved so that box, plus padding on every side, starts at
 *    (0, 0). The padding keeps anti-aliased glyph edges inside the form
 *    XObject the block becomes (a form clips to its box).
 *
 * @param lines The measured ink of each line, `null` for blank lines.
 * @param fontSize The font size in points.
 * @returns The block size and line origins (an empty block when every line
 *   is blank).
 */
export function layoutTextBlock(
  lines: readonly (LineBounds | null)[],
  fontSize: number,
): TextBlock {
  const measured = lines.filter((l): l is LineBounds => l !== null);
  if (measured.length === 0) {
    return { size: { width: 0, height: 0 }, origins: lines.map(() => null) };
  }
  const lineStep = LINE_HEIGHT * fontSize;
  const widest = Math.max(...measured.map((l) => l.right - l.left));

  // Steps 1 and 2: each line's origin before the block is moved.
  const placed = lines.map((l, i) =>
    l === null
      ? null
      : { x: widest / 2 - (l.left + l.right) / 2, y: -i * lineStep, ink: l },
  );

  // Step 3: union of the ink boxes, then shift by the padding.
  let bottom = Infinity;
  let top = -Infinity;
  for (const p of placed) {
    if (!p) continue;
    bottom = Math.min(bottom, p.y + p.ink.bottom);
    top = Math.max(top, p.y + p.ink.top);
  }
  const pad = TEXT_PADDING_RATIO * fontSize;
  return {
    size: { width: widest + 2 * pad, height: top - bottom + 2 * pad },
    origins: placed.map((p) =>
      p ? { x: pad + p.x, y: pad + p.y - bottom } : null,
    ),
  };
}
