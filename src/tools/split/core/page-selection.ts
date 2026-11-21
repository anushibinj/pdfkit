import {
  expandPageRuns,
  formatPageRuns,
  parsePageRuns,
  toPageRuns,
} from "@/lib/page-ranges";

/**
 * The pages picked for extracting or removing.
 *
 * Two inputs edit the same selection: clicking page thumbnails and typing
 * into the page field. Both are kept in sync here:
 * - a click changes `pages` and rewrites `text` in its tidy form
 *   ("1-3, 5"), so the field always shows what the thumbnails show;
 * - typing changes `text`; when it reads as a valid list, `pages` follows.
 *   While it does not (half typed, or a mistake), `error` says why and
 *   `pages` keeps the last valid selection, so the thumbnails do not flicker
 *   on every keystroke.
 */
export interface PageSelection {
  /** What the page field shows. */
  text: string;
  /** The selected pages, as 0-based indices. */
  pages: ReadonlySet<number>;
  /** Why `text` is not a valid page list, or null when it is. */
  error: string | null;
  /** The page last clicked without Shift: where a Shift-click range starts. */
  anchor: number | null;
}

export type SelectionAction =
  /** The person typed into the page field. */
  | { type: "type"; text: string; pageCount: number }
  /**
   * The person clicked a page thumbnail. `extend` is a Shift-click: select
   * every page from the anchor to this one.
   */
  | { type: "toggle"; index: number; extend: boolean }
  /** Forget the selection (new file, or the Clear button). */
  | { type: "clear" };

/** Nothing selected. */
export const EMPTY_SELECTION: PageSelection = {
  text: "",
  pages: new Set(),
  error: null,
  anchor: null,
};

/**
 * Apply one user action to the selection. Pure: returns a new state.
 *
 * @param state The current selection.
 * @param action What happened.
 * @returns The next selection.
 */
export function selectionReducer(
  state: PageSelection,
  action: SelectionAction,
): PageSelection {
  switch (action.type) {
    case "clear":
      return EMPTY_SELECTION;
    case "type": {
      const parsed = parsePageRuns(action.text, action.pageCount);
      if (!parsed.ok) return { ...state, text: action.text, error: parsed.error };
      return {
        text: action.text,
        pages: new Set(expandPageRuns(parsed.runs)),
        error: null,
        anchor: state.anchor,
      };
    }
    case "toggle": {
      const pages = toggledPages(state, action.index, action.extend);
      return {
        text: describePages(pages),
        pages,
        error: null,
        // A Shift-click keeps the anchor, so the next Shift-click still
        // measures from the page clicked before it (like file managers).
        anchor: action.extend && state.anchor !== null ? state.anchor : action.index,
      };
    }
  }
}

/**
 * Work out the pages after a click.
 *
 * - A plain click (or a Shift-click with no earlier click to start from)
 *   flips that one page.
 * - A Shift-click selects every page between the anchor and the clicked
 *   page, both included, whichever comes first. It only adds pages: a
 *   person who Shift-clicks expects the whole stretch to end up selected.
 *
 * @param state The current selection.
 * @param index The clicked page.
 * @param extend Whether Shift was held.
 * @returns A new set of pages.
 */
function toggledPages(
  state: PageSelection,
  index: number,
  extend: boolean,
): Set<number> {
  const pages = new Set(state.pages);
  if (extend && state.anchor !== null) {
    const from = Math.min(state.anchor, index);
    const to = Math.max(state.anchor, index);
    for (let page = from; page <= to; page++) pages.add(page);
  } else if (pages.has(index)) {
    pages.delete(index);
  } else {
    pages.add(index);
  }
  return pages;
}

/**
 * Write a set of pages in the page field's tidy form, in page order.
 *
 * @param pages 0-based indices.
 * @returns For example "1-3, 5" ("" when empty).
 */
export function describePages(pages: ReadonlySet<number>): string {
  return formatPageRuns(toPageRuns([...pages].sort((a, b) => a - b)), ", ");
}
