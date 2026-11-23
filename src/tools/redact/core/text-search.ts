import type { PageBox } from "@/lib/pdfium/page-box";
import type { TextFragment } from "@/tools/edit/core/text-runs";
import type { RedactionMark, RedactionSource } from "./model";
import type { PatternMatcher } from "./presets";

/** One non-generated character extracted from a PDF page with user-space geometry. */
export interface PageCharWithBox {
  /** Unicode character string (1 or 2 UTF-16 code units). */
  char: string;
  /** Baseline origin X in PDF user space (points). */
  x: number;
  /** Baseline origin Y in PDF user space (points). */
  y: number;
  /** Tight glyph bounding box in PDF user space (points). */
  box: PageBox;
  /** Object index in `FPDFPage_GetObject` for the owning text object, or -1. */
  textObjectIndex: number;
  /** Explicit word space before this char reported by PDFium's text extractor. */
  spaceBefore?: boolean;
  /** Explicit line break before this char reported by PDFium's text extractor. */
  newlineBefore?: boolean;
}

/** Searchable text buffer paired with a per-UTF-16-offset map back to page characters. */
export interface SearchablePageText {
  text: string;
  /** Parallel to `text` UTF-16 indices (`null` for synthetic whitespace/newlines). */
  charRefs: (PageCharWithBox | null)[];
}

/** One contiguous un-redacted slice of a straddling PDF text object. */
export interface KeptTextSpan {
  text: string;
  /** User-space baseline origin X of the first character in this span. */
  originX: number;
  /** User-space baseline origin Y of the first character in this span. */
  originY: number;
}

/** Surgical action computed for a single `TextFragment` on a page. */
export type TextObjectSplitAction =
  | { kind: "keep"; fragmentIndex: number }
  | { kind: "remove"; fragmentIndex: number }
  | { kind: "split"; fragmentIndex: number; spans: KeptTextSpan[] };

/**
 * Compute whether two PDF user-space bounding boxes overlap (including touching edges).
 *
 * @param a First box.
 * @param b Second box.
 * @returns `true` if the boxes intersect.
 */
export function boxesOverlap(a: PageBox, b: PageBox): boolean {
  return (
    a.right >= b.left &&
    b.right >= a.left &&
    a.top >= b.bottom &&
    b.top >= a.bottom
  );
}

/**
 * Determine whether a character's glyph box is covered by a redaction box.
 *
 * Uses either:
 * 1. The glyph center point lying inside `box` (fast & natural for drawn boxes), or
 * 2. At least 25% of the glyph's bounding-box area intersecting `box` (catches wide
 *    characters clipped near an edge).
 *
 * @param charBox Tight glyph box in user space.
 * @param redactionBox Redaction rectangle in user space.
 * @returns `true` if the character should be deleted.
 */
export function isCharCoveredByBox(
  charBox: PageBox,
  redactionBox: PageBox,
): boolean {
  const cx = (charBox.left + charBox.right) / 2;
  const cy = (charBox.bottom + charBox.top) / 2;
  if (
    cx >= redactionBox.left &&
    cx <= redactionBox.right &&
    cy >= redactionBox.bottom &&
    cy <= redactionBox.top
  ) {
    return true;
  }

  const ix = Math.max(
    0,
    Math.min(charBox.right, redactionBox.right) -
      Math.max(charBox.left, redactionBox.left),
  );
  const iy = Math.max(
    0,
    Math.min(charBox.top, redactionBox.top) -
      Math.max(charBox.bottom, redactionBox.bottom),
  );
  const overlapArea = ix * iy;
  if (overlapArea <= 0) return false;
  const charArea = Math.max(
    1e-6,
    (charBox.right - charBox.left) * (charBox.top - charBox.bottom),
  );
  return overlapArea / charArea >= 0.25;
}

/**
 * Build a searchable string from extracted PDFium characters, inserting spaces
 * between words and newlines between lines while keeping an exact UTF-16 index
 * lookup table back to the source {@link PageCharWithBox} items.
 *
 * @param chars Extracted non-generated page characters in reading order.
 * @returns Searchable text and per-index character references.
 */
export function buildSearchablePageText(
  chars: readonly PageCharWithBox[],
): SearchablePageText {
  const parts: string[] = [];
  const charRefs: (PageCharWithBox | null)[] = [];
  let prev: PageCharWithBox | null = null;

  for (const cur of chars) {
    if (cur.char.length === 0) continue;
    if (prev !== null) {
      if (cur.newlineBefore) {
        parts.push("\n");
        charRefs.push(null);
      } else if (cur.spaceBefore) {
        parts.push(" ");
        charRefs.push(null);
      } else if (cur.newlineBefore === undefined && cur.spaceBefore === undefined) {
        // Geometric fallback for synthetic unit-test character arrays.
        const prevH = Math.max(4, prev.box.top - prev.box.bottom);
        const curH = Math.max(4, cur.box.top - cur.box.bottom);
        const lineTol = Math.max(prevH, curH) * 0.45;
        const sameLine = Math.abs(prev.y - cur.y) <= lineTol;

        if (!sameLine || cur.box.left < prev.box.left - Math.max(prevH, curH)) {
          parts.push("\n");
          charRefs.push(null);
        } else {
          const gap = cur.box.left - prev.box.right;
          if (gap > Math.min(prevH, curH) * 0.3) {
            parts.push(" ");
            charRefs.push(null);
          }
        }
      }
    }

    parts.push(cur.char);
    // Push once per UTF-16 code unit so `text.indexOf` / regex offsets align 1:1.
    for (let u = 0; u < cur.char.length; u++) {
      charRefs.push(cur);
    }
    prev = cur;
  }

  return { text: parts.join(""), charRefs };
}

/**
 * Run a {@link PatternMatcher} against one page's characters and convert every
 * match into user-space {@link RedactionMark} candidates.
 *
 * Matches that wrap across two visual lines are split into one tight box per
 * line so unrelated text in margins is never covered.
 *
 * @param pageIndex Zero-based page index.
 * @param chars Extracted characters on that page.
 * @param matcher Pattern matcher strategy (text, regex, or preset).
 * @param source Origin tag stored on produced marks.
 * @returns Candidate marks (without client IDs).
 */
export function locatePatternMatchesOnPage(
  pageIndex: number,
  chars: readonly PageCharWithBox[],
  matcher: PatternMatcher,
  source: RedactionSource = matcher.source,
): Omit<RedactionMark, "id">[] {
  const { text, charRefs } = buildSearchablePageText(chars);
  if (text.length === 0) return [];
  const matches = matcher.findMatches(text);
  const marks: Omit<RedactionMark, "id">[] = [];
  const pad = 0.5;

  for (const match of matches) {
    const matchedChars: PageCharWithBox[] = [];
    const seen = new Set<PageCharWithBox>();
    for (let i = match.start; i < match.end; i++) {
      const ref = charRefs[i];
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        matchedChars.push(ref);
      }
    }
    if (matchedChars.length === 0) continue;

    // Group matched characters by visual line so multi-line wraps stay tight.
    const lines: PageCharWithBox[][] = [];
    for (const ch of matchedChars) {
      const lastLine = lines[lines.length - 1];
      if (!lastLine) {
        lines.push([ch]);
        continue;
      }
      const anchor = lastLine[lastLine.length - 1];
      const h = Math.max(
        4,
        anchor.box.top - anchor.box.bottom,
        ch.box.top - ch.box.bottom,
      );
      if (Math.abs(anchor.y - ch.y) <= h * 0.45 && ch.box.left >= anchor.box.left - h) {
        lastLine.push(ch);
      } else {
        lines.push([ch]);
      }
    }

    for (const line of lines) {
      marks.push({
        pageIndex,
        box: {
          left: Math.min(...line.map((c) => c.box.left)) - pad,
          bottom: Math.min(...line.map((c) => c.box.bottom)) - pad,
          right: Math.max(...line.map((c) => c.box.right)) + pad,
          top: Math.max(...line.map((c) => c.box.top)) + pad,
        },
        term: match.value,
        source,
        label: matcher.label,
        enabled: true,
      });
    }
  }

  return marks;
}

/**
 * Extract readable text covered by a manually drawn redaction rectangle so the
 * review list and post-save verification know which characters were redacted.
 *
 * @param chars Extracted page characters.
 * @param box User-space redaction box.
 * @returns Covered text trimmed of leading/trailing whitespace.
 */
export function extractTextUnderBox(
  chars: readonly PageCharWithBox[],
  box: PageBox,
): string {
  const covered = chars.filter((c) => isCharCoveredByBox(c.box, box));
  return buildSearchablePageText(covered).text.trim();
}

/**
 * Compute how each existing PDF text object (`TextFragment`) on a page must be
 * updated for a set of redaction boxes: kept untouched, deleted completely, or
 * split into surviving left/right spans when glyphs straddle a redaction box.
 *
 * @param fragments Page text fragments read from PDFium.
 * @param chars Character-level geometry linked by `textObjectIndex`.
 * @param redactionBoxes Active redaction rectangles on this page.
 * @returns One split/keep/remove decision per fragment.
 */
export function splitTextObjectByBoxes(
  fragments: readonly TextFragment[],
  chars: readonly PageCharWithBox[],
  redactionBoxes: readonly PageBox[],
): TextObjectSplitAction[] {
  if (redactionBoxes.length === 0) {
    return fragments.map((f) => ({ kind: "keep", fragmentIndex: f.index }));
  }

  const charsByObject = new Map<number, PageCharWithBox[]>();
  for (const ch of chars) {
    if (ch.textObjectIndex < 0) continue;
    let list = charsByObject.get(ch.textObjectIndex);
    if (!list) {
      list = [];
      charsByObject.set(ch.textObjectIndex, list);
    }
    list.push(ch);
  }

  const actions: TextObjectSplitAction[] = [];
  for (const fragment of fragments) {
    const objChars = charsByObject.get(fragment.index);
    if (!objChars || objChars.length === 0) {
      const overlaps = redactionBoxes.some((b) =>
        boxesOverlap(fragment.bounds, b),
      );
      actions.push({
        kind: overlaps ? "remove" : "keep",
        fragmentIndex: fragment.index,
      });
      continue;
    }

    const flags = objChars.map((c) =>
      redactionBoxes.some((b) => isCharCoveredByBox(c.box, b)),
    );
    const hitCount = flags.filter(Boolean).length;
    if (hitCount === 0) {
      actions.push({ kind: "keep", fragmentIndex: fragment.index });
      continue;
    }
    if (hitCount === objChars.length) {
      actions.push({ kind: "remove", fragmentIndex: fragment.index });
      continue;
    }

    // Group surviving characters into contiguous spans, inserting a single space
    // only when PDFium's character geometry shows a word gap inside the span.
    const spans: KeptTextSpan[] = [];
    let currentSpanChars: PageCharWithBox[] = [];

    const flush = () => {
      // Trim leading whitespace characters so the span's origin matches its
      // first visible glyph rather than a deleted-edge space.
      let start = 0;
      while (
        start < currentSpanChars.length &&
        currentSpanChars[start].char.trim().length === 0
      ) {
        start++;
      }
      const trimmed = currentSpanChars.slice(start);
      const spanText = buildSearchablePageText(trimmed).text.trim();
      if (spanText.length > 0) {
        const first = trimmed[0];
        spans.push({
          text: spanText,
          originX: first.x,
          originY: first.y,
        });
      }
      currentSpanChars = [];
    };

    for (let i = 0; i < objChars.length; i++) {
      if (flags[i]) {
        if (currentSpanChars.length > 0) flush();
      } else {
        currentSpanChars.push(objChars[i]);
      }
    }
    if (currentSpanChars.length > 0) flush();

    if (spans.length === 0) {
      actions.push({ kind: "remove", fragmentIndex: fragment.index });
    } else {
      actions.push({
        kind: "split",
        fragmentIndex: fragment.index,
        spans,
      });
    }
  }

  return actions;
}
