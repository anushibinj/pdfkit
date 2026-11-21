/**
 * Page numbers as people type them ("1-3, 5, 8-") and as the engines need
 * them (0-based page indices).
 *
 * Convention used everywhere in this tool: **inside the code a page is a
 * 0-based index**; only text shown to or typed by a person uses 1-based page
 * numbers. The conversion happens in this module and nowhere else.
 */

/** An inclusive run of consecutive pages, as 0-based page indices. */
export interface PageRun {
  first: number;
  last: number;
}

/** The outcome of reading a typed page list. */
export type RangeParseResult =
  | {
      ok: true;
      /** One run per comma-separated item, in the order typed. */
      runs: PageRun[];
    }
  | { ok: false; error: string };

/**
 * One item of the list: optional start, optional dash, optional end.
 *
 * Hyphen, en dash and em dash all count as a dash, because text pasted from
 * word processors often turns "1-3" into "1–3". Whitespace around each part
 * is allowed ("1 - 3"). Which combinations are valid is decided in
 * {@link parseItem}, not by the pattern, so each mistake gets its own
 * message.
 */
const ITEM = /^(\d*)\s*([-–—]?)\s*(\d*)$/;

/**
 * Read a list of pages and ranges typed by a person.
 *
 * Syntax (page numbers start at 1):
 * - `5` one page;
 * - `1-3` pages 1 to 3;
 * - `8-` page 8 to the last page;
 * - `-3` the first page to page 3;
 * - items are separated by commas: `1-3, 5, 8-`.
 *
 * Empty items are skipped, so a trailing comma typed on the way to the next
 * item ("1-3,") is not an error, and blank text gives an empty list. Ranges
 * may overlap or repeat; what that means is up to the caller.
 *
 * @param text What the person typed.
 * @param pageCount Pages in the document (at least 1).
 * @returns The runs as 0-based indices, or the first problem found, worded
 *   for the person.
 */
export function parsePageRanges(
  text: string,
  pageCount: number,
): RangeParseResult {
  const runs: PageRun[] = [];
  for (const raw of text.split(",")) {
    const item = raw.trim();
    if (item === "") continue;
    const parsed = parseItem(item, pageCount);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    runs.push(parsed);
  }
  return { ok: true, runs };
}

/**
 * Read one comma-separated item.
 *
 * @param item The item, already trimmed and non-empty.
 * @param pageCount Pages in the document.
 * @returns The run, or a message explaining what is wrong with it.
 */
function parseItem(item: string, pageCount: number): PageRun | { error: string } {
  const match = ITEM.exec(item);
  if (!match) {
    return {
      error: `"${item}" is not a page number or a range. Use numbers like 1-3, 5.`,
    };
  }
  const [, start, dash, end] = match;
  if (!dash) {
    // Without a dash only a single number is valid; "1 2" matches the pattern
    // as start "1" and end "2", which is a missing comma, not a range.
    if (end !== "") {
      return { error: `"${item}" needs a comma or a dash between the numbers.` };
    }
    const page = toIndex(start, item, pageCount);
    return typeof page === "number" ? { first: page, last: page } : page;
  }
  if (start === "" && end === "") {
    return { error: `"${item}" needs a page number before or after the dash.` };
  }
  // An open start means "from the first page", an open end "to the last".
  const first = start === "" ? 0 : toIndex(start, item, pageCount);
  if (typeof first !== "number") return first;
  const last = end === "" ? pageCount - 1 : toIndex(end, item, pageCount);
  if (typeof last !== "number") return last;
  if (first > last) {
    return {
      error: `"${item}" goes backwards. Write it as ${last + 1}-${first + 1}.`,
    };
  }
  return { first, last };
}

/**
 * Turn a typed 1-based page number into a 0-based index, checking that the
 * page exists.
 *
 * @param digits The number as typed (digits only).
 * @param item The whole item, for the message.
 * @param pageCount Pages in the document.
 * @returns The index, or a message.
 */
function toIndex(
  digits: string,
  item: string,
  pageCount: number,
): number | { error: string } {
  const page = Number(digits);
  if (page < 1) return { error: `"${item}": pages start at 1.` };
  if (page > pageCount) {
    return {
      error:
        pageCount === 1
          ? `"${item}": this PDF has only 1 page.`
          : `"${item}": this PDF has only ${pageCount} pages.`,
    };
  }
  return page - 1;
}

/**
 * Group page indices into runs of consecutive pages, keeping their order.
 *
 * A run only continues while each index is exactly one more than the one
 * before it, so [0, 1, 2, 4] becomes 0-2 and 4, and a descending list such
 * as [2, 1] stays as two single pages (never a backwards run).
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
 * Write runs in the typed syntax, with 1-based page numbers: "1-3, 5".
 *
 * @param runs The runs.
 * @param separator Between runs: ", " for people, "," for qpdf's `--pages`.
 * @returns The text ("" for no runs).
 */
export function formatPageRuns(
  runs: readonly PageRun[],
  separator = ", ",
): string {
  return runs
    .map(({ first, last }) =>
      first === last ? `${first + 1}` : `${first + 1}-${last + 1}`,
    )
    .join(separator);
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
