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

/** One item: "5", "2-7", "8-" (to the last page) or "-3" (from the first). */
const ITEM = /^(\d+)?\s*-\s*(\d+)?$|^(\d+)$/;

/**
 * Parse page ranges as people type them, e.g. "1-3, 5, 8-".
 *
 * Rules:
 * - Empty text (or only spaces) means every page.
 * - Items are separated by commas; spaces around items and around "-" are
 *   ignored, and empty items ("1,,2", a trailing comma while typing) are
 *   skipped.
 * - An item is a page ("5"), a range ("2-7"), a range to the last page
 *   ("8-") or from the first page ("-3"). En and em dashes count as "-",
 *   because they often arrive by copy and paste.
 * - Page numbers start at 1 and must exist; a range must not go backwards.
 * - Overlapping items are merged, so "1-3, 2" is pages 1, 2 and 3.
 *
 * @param input The text.
 * @param pageCount How many pages the PDF has (at least 1).
 * @returns The selected 0-based indices, or an error message.
 */
export function parsePageRanges(
  input: string,
  pageCount: number,
): PageRangeResult {
  const text = input.replace(/[–—]/g, "-").trim();
  if (text === "") return { ok: true, pages: range(0, pageCount - 1) };
  const items = text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (items.length === 0)
    return { ok: false, error: "Enter page numbers such as 1-3, 5." };

  const selected = new Set<number>();
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
    for (const index of range(first - 1, last - 1)) selected.add(index);
  }
  return { ok: true, pages: [...selected].sort((a, b) => a - b) };
}

/**
 * Write 0-based page indices as 1-based page ranges, the syntax qpdf's
 * `--to` and `--from` options take (and the way people read them).
 *
 * The order is kept and numbers may repeat, because for `--from` the n-th
 * entry pairs with the n-th destination page. Only runs that go up by
 * exactly one become ranges: [0, 1, 2, 4, 4] -> "1-3,5,5".
 *
 * @param indices 0-based page indices.
 * @returns The list, e.g. "1-3,5" ("" for no pages).
 */
export function formatPageRanges(indices: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < indices.length) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++;
    parts.push(
      j === i ? `${indices[i] + 1}` : `${indices[i] + 1}-${indices[j] + 1}`,
    );
    i = j + 1;
  }
  return parts.join(",");
}

/**
 * The integers from `first` to `last`, inclusive.
 *
 * @param first Start.
 * @param last End (no numbers when it is below `first`).
 * @returns The numbers in ascending order.
 */
function range(first: number, last: number): number[] {
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, i) => first + i,
  );
}
