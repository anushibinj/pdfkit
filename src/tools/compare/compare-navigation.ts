/**
 * Pure navigation and display-formatting helpers for Compare PDFs.
 */
import type {
  AlignedPagePair,
  CompareSummary,
  TextChange,
} from "./core/model";

/** Flat pointer to one navigable text change across the aligned pairs. */
export interface FlattenedChange {
  globalIndex: number;
  pairIndex: number;
  change: TextChange;
}

/**
 * Flatten all {@link TextChange}s across aligned pairs in document order.
 *
 * @param summary Completed comparison summary, or `null`.
 * @returns Ordered list of navigable change entries.
 */
export function flattenTextChanges(
  summary: CompareSummary | null,
): FlattenedChange[] {
  if (!summary) return [];
  const items: FlattenedChange[] = [];
  for (const pair of summary.pairs) {
    for (const change of pair.changes) {
      items.push({
        globalIndex: items.length,
        pairIndex: pair.pairIndex,
        change,
      });
    }
  }
  return items;
}

/**
 * Step a cyclic change cursor forward (`+1`) or backward (`-1`), wrapping
 * cleanly around `[0, total - 1]`.
 *
 * @param current Current zero-based active index (or `-1` if none selected yet).
 * @param total Total number of navigable changes.
 * @param delta `+1` for next, `-1` for previous.
 * @returns Next zero-based index, or `-1` when `total <= 0`.
 */
export function stepCyclicIndex(
  current: number,
  total: number,
  delta: -1 | 1,
): number {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) {
    return delta > 0 ? 0 : total - 1;
  }
  return (((current + delta) % total) + total) % total;
}

/**
 * Format a human-readable label describing an aligned page pair's mapping.
 *
 * @param pair Aligned pair metadata.
 * @returns Label such as `"Original p.2 ↔ Revised p.3"`.
 */
export function formatPairLabel(pair: AlignedPagePair): string {
  if (pair.status === "added") {
    return `Added: Revised p.${pair.rightIndex! + 1}`;
  }
  if (pair.status === "removed") {
    return `Removed: Original p.${pair.leftIndex! + 1}`;
  }
  return `Original p.${pair.leftIndex! + 1} ↔ Revised p.${pair.rightIndex! + 1}`;
}

/**
 * Derive a clean filename for the downloaded Comparison Report PDF.
 *
 * @param leftFileName Original PDF filename.
 * @param rightFileName Revised PDF filename.
 * @returns Sanitised `.pdf` filename.
 */
export function buildReportFileName(
  leftFileName: string,
  rightFileName: string,
): string {
  const strip = (name: string) => name.replace(/\.pdf$/i, "").trim() || "document";
  return `${strip(leftFileName)}-vs-${strip(rightFileName)}-comparison.pdf`;
}
