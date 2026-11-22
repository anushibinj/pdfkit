/**
 * Parse the "Pages" field: which pages of the PDF to convert. Pure.
 *
 * Accepted input, 1-based like page numbers in a reader:
 * - empty (or only spaces): every page;
 * - comma-separated items, each one of
 *   `7` (one page), `2-5` (a range), `8-` (8 to the last page),
 *   `-3` (the first page to 3). Spaces are allowed anywhere, and an en dash
 *   (as typed by some keyboards and autocorrect) counts as a hyphen.
 */

/** The outcome of parsing: page indices, or a message for the user. */
export type PageSelection =
  | {
      ok: true;
      /** Zero-based page indices, ascending, without duplicates. */
      pages: number[];
    }
  | { ok: false; error: string };

/**
 * One item: either a single number (group 1), or a range with a dash and
 * optional ends (groups 2 and 3). Spelling the two shapes out separately
 * matters: a pattern like `(\d+)?-?(\d+)?` would also accept "3 4" (two
 * numbers, no dash) and silently read it as page 3.
 */
const ITEM = /^(?:(\d+)|(\d*)\s*-\s*(\d*))$/;

/**
 * Turn the text of the "Pages" field into page indices.
 *
 * How each comma-separated item is read:
 * 1. Normalise en dashes to "-" and trim spaces.
 * 2. Match {@link ITEM}. A lone number is one page. In a range, a missing
 *    start means page 1 and a missing end means the last page; a dash with
 *    neither number is rejected.
 * 3. Check 1 <= start <= end <= pageCount, then add every page in between.
 * Items may overlap ("1-3, 2"); the result is sorted and duplicates are
 * dropped, so the pages are always produced in document order.
 *
 * @param text What the user typed.
 * @param pageCount Number of pages in the PDF (at least 1).
 * @returns The selected zero-based indices, or an error message.
 */
export function parsePageRanges(
  text: string,
  pageCount: number,
): PageSelection {
  const all = (): PageSelection => ({
    ok: true,
    pages: Array.from({ length: pageCount }, (_, i) => i),
  });
  const normalised = text.replace(/\u2013/g, "-").trim();
  if (normalised === "") return all();

  const selected = new Set<number>();
  for (const raw of normalised.split(",")) {
    const item = raw.trim();
    if (item === "") continue; // tolerate "1, 2," and "1,,2"
    const match = ITEM.exec(item);
    // A range needs at least one end: a lone "-" is not an item.
    if (!match || (match[1] === undefined && !match[2] && !match[3])) {
      return { ok: false, error: `“${item}” is not a page number or range.` };
    }
    const [, single, from, to] = match;
    const start =
      single !== undefined ? Number(single) : from ? Number(from) : 1;
    const end = single !== undefined ? start : to ? Number(to) : pageCount;
    for (const page of [start, end]) {
      if (page < 1 || page > pageCount) {
        return {
          ok: false,
          error: `Page ${page} does not exist. This PDF has ${pageCount} ${pageCount === 1 ? "page" : "pages"}.`,
        };
      }
    }
    if (start > end) {
      return {
        ok: false,
        error: `“${item}” goes backwards. Write it as ${end}-${start}.`,
      };
    }
    for (let page = start; page <= end; page++) selected.add(page - 1);
  }
  if (selected.size === 0) return all();
  return { ok: true, pages: [...selected].sort((a, b) => a - b) };
}
