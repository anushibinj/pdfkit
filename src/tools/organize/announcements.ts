import {
  ARRANGE_MINIMUM,
  arrangeScope,
  type BoardAction,
  type BoardState,
} from "./core/board-state";

/**
 * "1 page" or "N pages".
 *
 * @param count A number of pages.
 * @returns The phrase.
 */
export function pageCountLabel(count: number): string {
  return count === 1 ? "1 page" : `${count} pages`;
}

/**
 * What to tell a screen reader user after a board action, so the result of
 * a toolbar button or shortcut is heard, not only seen.
 *
 * It compares the history before and after the action: when the action
 * changed nothing (rotating with nothing selected, deleting every page,
 * no landscape page to turn), it says so instead of claiming success.
 *
 * @param action The action that ran.
 * @param before The state it ran on.
 * @param after The state it produced.
 * @returns The message, or `null` for actions that need none (selection
 *   changes are announced by the listbox itself).
 */
export function announcementFor(
  action: BoardAction,
  before: BoardState,
  after: BoardState,
): string | null {
  const changed = after.history !== before.history;
  const selected = before.selection.keys.size;
  const pages = before.history.present;
  switch (action.type) {
    case "rotate":
      return changed
        ? `Turned ${pageCountLabel(selected)} ${action.delta > 0 ? "right" : "left"}.`
        : "Select pages to turn first.";
    case "move-by":
      return changed ? `Moved ${pageCountLabel(selected)}.` : null;
    case "delete":
      if (changed) return `Deleted ${pageCountLabel(selected)}.`;
      return selected > 0
        ? "The organized file needs at least one page."
        : "Select pages to delete first.";
    case "duplicate":
      return changed
        ? `Duplicated ${pageCountLabel(selected)}.`
        : "Select pages to duplicate first.";
    case "insert-blank":
      return changed ? "Inserted a blank page." : null;
    case "interleave":
    case "reverse":
    case "turn-landscape": {
      const { selectionOnly } = arrangeScope(
        pages,
        before.selection,
        ARRANGE_MINIMUM[action.type],
      );
      const which = selectionOnly ? "the selected pages" : "all pages";
      if (!changed)
        return action.type === "turn-landscape"
          ? `No landscape pages among ${which}.`
          : `The order of ${which} did not change.`;
      return action.type === "interleave"
        ? `Interleaved ${which}.`
        : action.type === "reverse"
          ? `Reversed ${which}.`
          : `Turned the landscape pages among ${which} upright.`;
    }
    case "undo":
      return changed ? "Undone." : null;
    case "redo":
      return changed ? "Redone." : null;
    default:
      return null;
  }
}
