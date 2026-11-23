/** The pages a crop applies to, or why the text does not name any. */
export type PageRangeResult =
  { ok: true; pages: number[] } | { ok: false; message: string };

/** Longest page range text accepted (a defence against pasted novels). */
const MAX_INPUT_LENGTH = 1000;

/**
 * Read a page range such as `1-3, 7, 10-12` into 0-based page indices.
 *
 * Rules: comma-separated parts; each part is a page number or `from-to`
 * (inclusive, `from` not after `to`); spaces anywhere are ignored; pages
 * are numbered from 1 and must exist. Repeated pages are listed once, and
 * the result is sorted.
 *
 * @param text What the user typed.
 * @param pageCount Pages in the document.
 * @returns The page indices, or a message saying what is wrong.
 */
export function parsePageRange(
  text: string,
  pageCount: number,
): PageRangeResult {
  if (text.length > MAX_INPUT_LENGTH) {
    return { ok: false, message: "The page range is too long." };
  }
  const parts = text
    .replace(/\s+/g, "")
    .split(",")
    .filter((p) => p !== "");
  if (parts.length === 0) {
    return { ok: false, message: "Enter the pages to crop, e.g. 1-3, 5." };
  }
  const pages = new Set<number>();
  for (const part of parts) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) {
      return { ok: false, message: `"${part}" is not a page or a range.` };
    }
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to > pageCount) {
      return {
        ok: false,
        message: `Pages go from 1 to ${pageCount}; "${part}" is outside that.`,
      };
    }
    if (from > to) {
      return { ok: false, message: `"${part}" runs backwards.` };
    }
    for (let page = from; page <= to; page++) pages.add(page - 1);
  }
  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
}

/**
 * Every page index of a document.
 *
 * @param pageCount Pages in the document.
 * @returns `[0, 1, ..., pageCount - 1]`.
 */
export function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, i) => i);
}
