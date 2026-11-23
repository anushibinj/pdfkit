/**
 * Word-level text diffing built on `jsdiff` (`diffArrays`), mapping diff hunks
 * back to exact PDF glyph boxes so highlights land accurately on the page.
 */
import { diffArrays, type ArrayChange } from "diff";
import type { PageBox, PageInfo } from "@/lib/pdfium/page-box";
import {
  mergeUserBoxesByLine,
  rectAnchorY,
  userBoxesToNormalizedViewRects,
} from "./box-geometry";
import type {
  ExtractedPageText,
  NormalizedRect,
  TextChange,
  TextChangeKind,
  WordToken,
} from "./model";

/**
 * Strategy interface for computing a sequence diff over normalised word arrays
 * (Dependency Inversion: decouples domain diffing from `jsdiff`).
 */
export interface WordDiffEngine {
  /**
   * Compute an ordered list of unchanged, added, and removed token chunks.
   *
   * @param leftWords Normalised tokens of the original page.
   * @param rightWords Normalised tokens of the revised page.
   * @returns Ordered diff chunks.
   */
  diff(
    leftWords: readonly string[],
    rightWords: readonly string[],
  ): ArrayChange<string>[];
}

/** Default word diff engine backed by `jsdiff`'s Myers `diffArrays`. */
export class JsDiffWordEngine implements WordDiffEngine {
  /**
   * Run Myers array diff over two arrays of normalised word strings.
   *
   * @param leftWords Original page words.
   * @param rightWords Revised page words.
   * @returns Diff chunks in document order.
   */
  diff(
    leftWords: readonly string[],
    rightWords: readonly string[],
  ): ArrayChange<string>[] {
    return diffArrays([...leftWords], [...rightWords]);
  }
}

/**
 * Collect and line-merge both PDF user-space and normalised view-space rects
 * for a contiguous slice of {@link WordToken}s.
 *
 * @param tokens Slice of changed tokens.
 * @param info Page geometry used for user-to-view projection.
 * @returns User-space and view-space highlight rectangles.
 */
function rectsForTokens(
  tokens: readonly WordToken[],
  info: PageInfo,
): { userRects: PageBox[]; viewRects: NormalizedRect[] } {
  const rawBoxes: PageBox[] = [];
  for (const token of tokens) {
    for (const box of token.boxes) rawBoxes.push(box);
  }
  return {
    userRects: mergeUserBoxesByLine(rawBoxes),
    viewRects: userBoxesToNormalizedViewRects(rawBoxes, info),
  };
}

/**
 * Format a slice of tokens back into readable text for summary lists and PDF
 * annotation comments.
 *
 * @param tokens Slice of word/punctuation tokens.
 * @returns Space-joined surface text.
 */
function joinTokens(tokens: readonly WordToken[]): string {
  return tokens.map((t) => t.text).join(" ");
}

/**
 * Build a {@link TextChange} from an unmatched added or removed page.
 *
 * @param pairIndex Aligned pair index.
 * @param kind `"added"` or `"removed"`.
 * @param page Extracted page text of the unmatched page.
 * @returns Single-element array if the page contains text, else empty array.
 */
function buildWholePageChange(
  pairIndex: number,
  kind: "added" | "removed",
  page: ExtractedPageText,
): TextChange[] {
  if (page.tokens.length === 0) return [];
  const { userRects, viewRects } = rectsForTokens(page.tokens, page.info);
  const text = joinTokens(page.tokens);
  return [
    {
      id: `p${pairIndex}-c0`,
      pairIndex,
      kind,
      leftText: kind === "removed" ? text : "",
      rightText: kind === "added" ? text : "",
      leftUserRects: kind === "removed" ? userRects : [],
      rightUserRects: kind === "added" ? userRects : [],
      leftViewRects: kind === "removed" ? viewRects : [],
      rightViewRects: kind === "added" ? viewRects : [],
      anchorY: rectAnchorY(viewRects),
    },
  ];
}

/**
 * Compute word-level {@link TextChange} hunks between a pair of aligned pages.
 *
 * @param pairIndex Zero-based index in {@link CompareSummary.pairs}.
 * @param left Extracted text of the original page, or `null` for an added page.
 * @param right Extracted text of the revised page, or `null` for a removed page.
 * @param diffEngine Word diff strategy (defaults to {@link JsDiffWordEngine}).
 * @returns Ordered list of text change hunks with exact glyph boxes.
 */
export function diffPageText(
  pairIndex: number,
  left: ExtractedPageText | null,
  right: ExtractedPageText | null,
  diffEngine: WordDiffEngine = new JsDiffWordEngine(),
): TextChange[] {
  if (!left && !right) return [];
  if (!left && right) return buildWholePageChange(pairIndex, "added", right);
  if (left && !right) return buildWholePageChange(pairIndex, "removed", left);

  const leftPage = left!;
  const rightPage = right!;
  const leftWords = leftPage.tokens.map((t) => t.normalizedText);
  const rightWords = rightPage.tokens.map((t) => t.normalizedText);
  const chunks = diffEngine.diff(leftWords, rightWords);

  const changes: TextChange[] = [];
  let leftCursor = 0;
  let rightCursor = 0;
  let changeCounter = 0;

  let i = 0;
  while (i < chunks.length) {
    const chunk = chunks[i];
    const len = chunk.value.length;

    if (!chunk.added && !chunk.removed) {
      leftCursor += len;
      rightCursor += len;
      i++;
      continue;
    }

    let removedCount = 0;
    let addedCount = 0;
    while (i < chunks.length && (chunks[i].added || chunks[i].removed)) {
      if (chunks[i].removed) removedCount += chunks[i].value.length;
      else addedCount += chunks[i].value.length;
      i++;
    }

    const leftSlice = leftPage.tokens.slice(
      leftCursor,
      leftCursor + removedCount,
    );
    const rightSlice = rightPage.tokens.slice(
      rightCursor,
      rightCursor + addedCount,
    );
    leftCursor += removedCount;
    rightCursor += addedCount;

    const kind: TextChangeKind =
      leftSlice.length > 0 && rightSlice.length > 0
        ? "modified"
        : leftSlice.length > 0
          ? "removed"
          : "added";

    const leftRects = rectsForTokens(leftSlice, leftPage.info);
    const rightRects = rectsForTokens(rightSlice, rightPage.info);

    const anchorY =
      rightRects.viewRects.length > 0
        ? rectAnchorY(rightRects.viewRects)
        : rectAnchorY(leftRects.viewRects);

    changes.push({
      id: `p${pairIndex}-c${changeCounter++}`,
      pairIndex,
      kind,
      leftText: joinTokens(leftSlice),
      rightText: joinTokens(rightSlice),
      leftUserRects: leftRects.userRects,
      rightUserRects: rightRects.userRects,
      leftViewRects: leftRects.viewRects,
      rightViewRects: rightRects.viewRects,
      anchorY,
    });
  }

  return changes;
}
