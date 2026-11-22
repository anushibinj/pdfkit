/**
 * Page numbers as people type them ("1-3, 5, 8-") and as engines need them
 * (0-based page indices). Shared by every tool that lets people pick pages.
 *
 * Convention: inside the code a page is a 0-based index; only text shown to
 * or typed by a person uses 1-based page numbers. The conversion happens in
 * this module.
 */

/** An inclusive run of consecutive pages, as 0-based page indices. */
export interface PageRun {
  first: number;
  last: number;
}

/** Outcome of {@link parsePageRuns}. */
export type PageRunsResult =
  | {
      ok: true;
      /** One run per comma-separated item, in the order typed. */
      runs: PageRun[];
    }
  | {
      ok: false;
      /** Why the text is not valid, for the user. */
      error: string;
    };

/** One item: "5", "2-7", "8-" (to the last page) or "-3" (from the first). */
const ITEM = /^(\d+)?\s*-\s*(\d+)?$|^(\d+)$/;

/**
 * Read a typed list of pages and ranges, item by item.
 *
 * Rules:
 * - Items are separated by commas; spaces around items and around "-" are
 *   ignored, and empty items ("1,,2", a trailing comma while typing) are
 *   skipped, so blank text gives no runs at all.
 * - An item is a page ("5"), a range ("2-7"), a range to the last page
 *   ("8-") or from the first page ("-3"). En and em dashes count as "-",
 *   because they often arrive by copy and paste.
 * - Page numbers start at 1 and must exist; a range must not go backwards.
 * - Items are kept as typed: in order, overlapping or repeated. What that
 *   means is the caller's decision (one file per item, or one set).
 *
 * @param input The text.
 * @param pageCount How many pages the PDF has (at least 1).
 * @returns One run per item (0-based), or the first problem found.
 */
export function parsePageRuns(
  input: string,
  pageCount: number,
): PageRunsResult {
  const items = input
    .replace(/[–—]/g, "-")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  const runs: PageRun[] = [];
  for (const item of items) {
    const m = ITEM.exec(item);
    if (!m) {
      return {
        ok: false,
        error: `“${item}” is not a page number or a range such as 2-5.`,
      };
    }
    // m[3]: a single page; m[1] / m[2]: the two ends of a range, either of
    // which may be left out (open-ended).
    const single = m[3] !== undefined ? Number(m[3]) : undefined;
    if (single === undefined && m[1] === undefined && m[2] === undefined) {
      return {
        ok: false,
        error: "“-” needs a page number on at least one side.",
      };
    }
    const first = single ?? (m[1] !== undefined ? Number(m[1]) : 1);
    const last = single ?? (m[2] !== undefined ? Number(m[2]) : pageCount);
    for (const page of [first, last]) {
      if (page < 1) return { ok: false, error: "Page numbers start at 1." };
      if (page > pageCount) {
        return {
          ok: false,
          error: `There is no page ${page}: this PDF has ${pageCount} ${pageCount === 1 ? "page" : "pages"}.`,
        };
      }
    }
    if (first > last) {
      return {
        ok: false,
        error: `“${item}” goes backwards. Write it as ${last}-${first}.`,
      };
    }
    runs.push({ first: first - 1, last: last - 1 });
  }
  return { ok: true, runs };
}

/**
 * Group page indices into runs of consecutive pages, keeping their order.
 *
 * A run only continues while each index is exactly one more than the one
 * before it, so [0, 1, 2, 4] becomes 0-2 and 4, and a descending list such
 * as [2, 1] stays as two single pages (never a backwards run, which qpdf
 * would read as "in reverse order").
 *
 * @param indices 0-based page indices.
 * @returns The runs, in the same order.
 */
export function toPageRuns(indices: readonly number[]): PageRun[] {
  const runs: PageRun[] = [];
  for (const index of indices) {
    const current = runs.at(-1);
    if (current && index === current.last + 1) current.last = index;
    else runs.push({ first: index, last: index });
  }
  return runs;
}

/**
 * Write runs with 1-based page numbers: "1-3,5", or "1-3, 5" for people.
 *
 * @param runs The runs.
 * @param separator Between runs: "," for qpdf (the default), ", " for people.
 * @returns The text ("" for no runs).
 */
export function formatPageRuns(
  runs: readonly PageRun[],
  separator = ",",
): string {
  return runs
    .map(({ first, last }) =>
      first === last ? `${first + 1}` : `${first + 1}-${last + 1}`,
    )
    .join(separator);
}

/**
 * Write 0-based page indices as 1-based page ranges, the syntax qpdf's page
 * options take (and the way people read them).
 *
 * The order is kept and numbers may repeat. Only runs that go up by exactly
 * one become ranges: [0, 1, 2, 4, 4] -> "1-3,5,5".
 *
 * @param indices 0-based page indices.
 * @param separator Between items: "," (default) or ", ".
 * @returns The list, e.g. "1-3,5" ("" for no pages).
 */
export function formatPageRanges(
  indices: readonly number[],
  separator = ",",
): string {
  return formatPageRuns(toPageRuns(indices), separator);
}

/**
 * List every page index covered by the runs, in order.
 *
 * @param runs The runs.
 * @returns The indices, run after run (repeats kept).
 */
export function expandPageRuns(runs: readonly PageRun[]): number[] {
  const pages: number[] = [];
  for (const { first, last } of runs) {
    for (let page = first; page <= last; page++) pages.push(page);
  }
  return pages;
}

/** Outcome of {@link parsePageSelection}. */
export type PageSelectionResult =
  | {
      ok: true;
      /** 0-based page indices, ascending, no duplicates. */ pages: number[];
    }
  | {
      ok: false;
      /** Why the text is not valid, for the user. */ error: string;
    };

/**
 * Parse a "Pages" field that selects a set of pages, e.g. "1-3, 5, 8-", for
 * tools that apply to some pages of one PDF (the watermark, PDF to Images).
 *
 * The syntax and its error messages are those of {@link parsePageRuns}.
 * What a selection adds:
 * - Empty text (or only spaces) means every page.
 * - Text with no items at all (only commas) is an error, not "every page".
 * - Overlapping items are merged, so "1-3, 2" is pages 1, 2 and 3, in
 *   ascending order.
 *
 * @param input The text.
 * @param pageCount How many pages the PDF has (at least 1).
 * @returns The selected 0-based indices, or an error message.
 */
export function parsePageSelection(
  input: string,
  pageCount: number,
): PageSelectionResult {
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
