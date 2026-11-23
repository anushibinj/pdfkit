/**
 * Monotonic sequence alignment of PDF pages across two revisions.
 *
 * When pages are inserted or deleted in the middle of a document, comparing
 * page `k` against page `k` marks every subsequent page as changed. Instead,
 * this module aligns pages using Needleman-Wunsch dynamic programming driven by
 * an injectable {@link PageSimilarityMetric} (Dependency Inversion & Open/Closed).
 */
import type { PageAlignmentStatus } from "./model";

/** Compact text and geometry fingerprint of one page used for alignment. */
export interface PageSignature {
  /** Zero-based page index in its document. */
  pageIndex: number;
  /** Lowercased/normalised word tokens on this page. */
  words: readonly string[];
  /** Displayed width / height ratio (used as tie-breaker for blank/scanned pages). */
  aspectRatio: number;
}

/** Strategy interface for scoring similarity between two pages in `[0, 1]`. */
export interface PageSimilarityMetric {
  /**
   * Compute similarity between `left` and `right` pages.
   *
   * @param left Signature of a page in the original document.
   * @param right Signature of a page in the revised document.
   * @returns Similarity in `[0, 1]`, where `1` means identical tokens.
   */
  score(left: PageSignature, right: PageSignature): number;
}

/** One raw slot produced by page alignment before diffing its text. */
export interface PageAlignmentEntry {
  leftIndex: number | null;
  rightIndex: number | null;
  status: PageAlignmentStatus;
  similarity: number;
}

/** Tunable thresholds for {@link alignPages}. */
export interface AlignmentOptions {
  /**
   * Minimum similarity `[0, 1]` required for two pages to be considered a
   * match rather than an insertion + deletion during DP scoring. Default `0.25`.
   */
  matchThreshold?: number;
}

/**
 * Default page similarity metric using multiset Dice coefficient (`2 * |A ∩ B| / (|A| + |B|)`).
 */
export class MultisetDiceSimilarity implements PageSimilarityMetric {
  /**
   * Compute multiset Dice similarity between two page signatures.
   *
   * @param left Original page signature.
   * @param right Revised page signature.
   * @returns Similarity score in `[0, 1]`.
   */
  score(left: PageSignature, right: PageSignature): number {
    const a = left.words;
    const b = right.words;

    if (a.length === 0 && b.length === 0) {
      const ratioDiff = Math.abs(left.aspectRatio - right.aspectRatio);
      return Math.max(0.35, 0.7 - Math.min(0.35, ratioDiff));
    }
    if (a.length === 0 || b.length === 0) {
      return 0;
    }

    const freqA = new Map<string, number>();
    for (const w of a) {
      const key = w.toLowerCase();
      freqA.set(key, (freqA.get(key) ?? 0) + 1);
    }

    let intersection = 0;
    for (const w of b) {
      const key = w.toLowerCase();
      const count = freqA.get(key);
      if (count && count > 0) {
        intersection++;
        freqA.set(key, count - 1);
      }
    }

    return (2 * intersection) / (a.length + b.length);
  }
}

/**
 * Post-process alignment entries so equal-length adjacent `(removed, added)`
 * gaps between matched anchors are paired as 1-to-1 `"matched"` page revisions.
 *
 * @param entries Raw DP alignment entries in document order.
 * @param metric Similarity metric used to record the pair's true similarity.
 * @param leftPages Left page signatures.
 * @param rightPages Right page signatures.
 * @returns Refined alignment entries.
 */
function pairRewrittenGaps(
  entries: readonly PageAlignmentEntry[],
  metric: PageSimilarityMetric,
  leftPages: readonly PageSignature[],
  rightPages: readonly PageSignature[],
): PageAlignmentEntry[] {
  const result: PageAlignmentEntry[] = [];
  let i = 0;

  while (i < entries.length) {
    if (entries[i].status === "matched") {
      result.push(entries[i]);
      i++;
      continue;
    }

    const removed: PageAlignmentEntry[] = [];
    const added: PageAlignmentEntry[] = [];
    while (i < entries.length && entries[i].status !== "matched") {
      if (entries[i].status === "removed") removed.push(entries[i]);
      else added.push(entries[i]);
      i++;
    }

    if (removed.length > 0 && removed.length === added.length) {
      for (let k = 0; k < removed.length; k++) {
        const lIdx = removed[k].leftIndex!;
        const rIdx = added[k].rightIndex!;
        result.push({
          leftIndex: lIdx,
          rightIndex: rIdx,
          status: "matched",
          similarity: metric.score(leftPages[lIdx], rightPages[rIdx]),
        });
      }
    } else {
      result.push(...removed, ...added);
    }
  }

  return result;
}

/**
 * Align pages of `leftPages` and `rightPages` monotonically using global
 * Needleman-Wunsch sequence alignment.
 *
 * @param leftPages Page signatures of the original document.
 * @param rightPages Page signatures of the revised document.
 * @param metric Similarity scorer (defaults to {@link MultisetDiceSimilarity}).
 * @param options Optional alignment thresholds.
 * @returns Ordered list of aligned page pairs and unmatched additions/removals.
 */
export function alignPages(
  leftPages: readonly PageSignature[],
  rightPages: readonly PageSignature[],
  metric: PageSimilarityMetric = new MultisetDiceSimilarity(),
  options: AlignmentOptions = {},
): PageAlignmentEntry[] {
  const n = leftPages.length;
  const m = rightPages.length;
  const threshold = options.matchThreshold ?? 0.25;

  if (n === 0) {
    return rightPages.map((p) => ({
      leftIndex: null,
      rightIndex: p.pageIndex,
      status: "added",
      similarity: 0,
    }));
  }
  if (m === 0) {
    return leftPages.map((p) => ({
      leftIndex: p.pageIndex,
      rightIndex: null,
      status: "removed",
      similarity: 0,
    }));
  }

  const sim: number[][] = Array.from({ length: n }, () =>
    new Array<number>(m).fill(0),
  );
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  // Move codes: 1 = diagonal (match), 2 = up (left removed), 3 = left (right added).
  const move: Uint8Array[] = Array.from(
    { length: n + 1 },
    () => new Uint8Array(m + 1),
  );

  for (let i = 1; i <= n; i++) move[i][0] = 2;
  for (let j = 1; j <= m; j++) move[0][j] = 3;

  const maxLen = Math.max(n, m);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = metric.score(leftPages[i - 1], rightPages[j - 1]);
      sim[i - 1][j - 1] = s;

      // Tiny positional tie-breaker ensures identical boilerplate/blank pages
      // match in order instead of arbitrarily skipping early pages.
      const posBias = 1e-4 * (1 - Math.abs(i - j) / maxLen);
      const diagScore = dp[i - 1][j - 1] + (s - threshold) + posBias;
      const upScore = dp[i - 1][j];
      const leftScore = dp[i][j - 1];

      if (diagScore >= upScore && diagScore >= leftScore && s >= threshold) {
        dp[i][j] = diagScore;
        move[i][j] = 1;
      } else if (upScore >= leftScore) {
        dp[i][j] = upScore;
        move[i][j] = 2;
      } else {
        dp[i][j] = leftScore;
        move[i][j] = 3;
      }
    }
  }

  const reversed: PageAlignmentEntry[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = move[i][j];
    if (step === 1) {
      reversed.push({
        leftIndex: leftPages[i - 1].pageIndex,
        rightIndex: rightPages[j - 1].pageIndex,
        status: "matched",
        similarity: sim[i - 1][j - 1],
      });
      i--;
      j--;
    } else if (step === 2) {
      reversed.push({
        leftIndex: leftPages[i - 1].pageIndex,
        rightIndex: null,
        status: "removed",
        similarity: 0,
      });
      i--;
    } else {
      reversed.push({
        leftIndex: null,
        rightIndex: rightPages[j - 1].pageIndex,
        status: "added",
        similarity: 0,
      });
      j--;
    }
  }

  reversed.reverse();
  return pairRewrittenGaps(reversed, metric, leftPages, rightPages);
}
