/**
 * Which board pages are selected. Selecting is not an edit, so it lives
 * outside the undo history; after an undo it is pruned to the pages that
 * still exist.
 */

/** The selected pages and where a Shift range starts. */
export interface BoardSelection {
  /** Keys of the selected pages. */
  readonly keys: ReadonlySet<string>;
  /**
   * The page a Shift+click or Shift+arrow range is measured from: the page
   * clicked (or toggled) last without Shift. `null` before any click.
   */
  readonly anchor: string | null;
}

/** Nothing selected. */
export const EMPTY_SELECTION: BoardSelection = {
  keys: new Set(),
  anchor: null,
};

/**
 * How a click changes the selection, following file-manager conventions:
 * - "only": a plain click selects just that page;
 * - "toggle": Ctrl/Cmd+click (or the page's tick box) adds or removes it;
 * - "range": Shift+click selects every page from the anchor to it;
 * - "add-range": Ctrl/Cmd+Shift+click adds that range to the selection.
 */
export type SelectMode = "only" | "toggle" | "range" | "add-range";

/**
 * The keys from `from` to `to`, inclusive, in board order (either direction).
 *
 * @param order Every page key, in board order.
 * @param from One end of the range.
 * @param to The other end.
 * @returns The keys in between, or `[to]` when `from` is not on the board.
 */
export function keyRange(
  order: readonly string[],
  from: string,
  to: string,
): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * Apply a click (or the keyboard equivalent) to the selection.
 *
 * The anchor moves to the clicked page for "only" and "toggle", and stays
 * put for the range modes, so Shift+clicking several times re-draws the
 * range from the same starting page, as in a file manager.
 *
 * @param selection The current selection.
 * @param order Every page key, in board order.
 * @param key The page that was clicked.
 * @param mode How the click was made.
 * @returns The new selection (the same object if nothing changed).
 */
export function selectPage(
  selection: BoardSelection,
  order: readonly string[],
  key: string,
  mode: SelectMode,
): BoardSelection {
  if (!order.includes(key)) return selection;
  switch (mode) {
    case "only":
      if (
        selection.keys.size === 1 &&
        selection.keys.has(key) &&
        selection.anchor === key
      )
        return selection;
      return { keys: new Set([key]), anchor: key };
    case "toggle": {
      const keys = new Set(selection.keys);
      if (keys.has(key)) keys.delete(key);
      else keys.add(key);
      return { keys, anchor: key };
    }
    case "range":
    case "add-range": {
      const anchor = selection.anchor ?? key;
      const range = keyRange(order, anchor, key);
      const keys =
        mode === "range"
          ? new Set(range)
          : new Set([...selection.keys, ...range]);
      return { keys, anchor };
    }
  }
}

/**
 * Replace the selection with the given pages.
 *
 * @param keys The pages to select.
 * @param anchor The new anchor; defaults to the first key, or `null`.
 * @returns The selection.
 */
export function selectKeys(
  keys: Iterable<string>,
  anchor?: string | null,
): BoardSelection {
  const set = new Set(keys);
  return {
    keys: set,
    anchor: anchor !== undefined ? anchor : (set.values().next().value ?? null),
  };
}

/**
 * Drop selected keys (and the anchor) that are no longer on the board, after
 * an undo, a redo or a deletion.
 *
 * @param selection The selection.
 * @param order Every page key, in board order.
 * @returns The pruned selection (the same object when nothing was stale).
 */
export function pruneSelection(
  selection: BoardSelection,
  order: readonly string[],
): BoardSelection {
  const present = new Set(order);
  const stale = [...selection.keys].some((k) => !present.has(k));
  const anchorStale =
    selection.anchor !== null && !present.has(selection.anchor);
  if (!stale && !anchorStale) return selection;
  return {
    keys: new Set([...selection.keys].filter((k) => present.has(k))),
    anchor: anchorStale ? null : selection.anchor,
  };
}

/**
 * The selected keys in board order (a `Set` remembers insertion order, which
 * is click order, not page order).
 *
 * @param order Every page key, in board order.
 * @param selection The selection.
 * @returns The selected keys, first page first.
 */
export function selectedInOrder(
  order: readonly string[],
  selection: BoardSelection,
): string[] {
  return order.filter((k) => selection.keys.has(k));
}
