import { expandPageRuns, parsePageRuns } from "@/lib/page-ranges";

// The writer is shared with other tools; re-exported so existing imports
// keep working.
export { formatPageRanges } from "@/lib/page-ranges";

/** Outcome of {@link parsePageRanges}. */
export type PageRangeResult =
  | {
      ok: true;
      /** 0-based page indices, ascending, no duplicates. */ pages: number[];
    }
  | {
      ok: false;
      /** Why the text is not valid, for the user. */ error: string;
    };

/**
 * Parse the watermark's page field, e.g. "1-3, 5, 8-".
 *
 * The syntax and its error messages are the shared ones (see
 * `parsePageRuns`). What this tool adds:
 * - Empty text (or only spaces) means every page.
 * - Text with no items at all (only commas) is an error, not "every page".
 * - Overlapping items are merged, so "1-3, 2" is pages 1, 2 and 3, in
 *   ascending order.
 *
 * @param input The text.
 * @param pageCount How many pages the PDF has (at least 1).
 * @returns The selected 0-based indices, or an error message.
 */
export function parsePageRanges(
  input: string,
  pageCount: number,
): PageRangeResult {
  if (input.replace(/[–—]/g, "-").trim() === "") {
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i) };
  }
  const parsed = parsePageRuns(input, pageCount);
  if (!parsed.ok) return parsed;
  if (parsed.runs.length === 0) {
    return { ok: false, error: "Enter page numbers such as 1-3, 5." };
  }
  const pages = new Set(expandPageRuns(parsed.runs));
  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
}
