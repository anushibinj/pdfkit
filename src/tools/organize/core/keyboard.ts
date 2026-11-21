/**
 * Keyboard support for the page board, as pure functions.
 *
 * The board is a grid of pages that reads left to right, top to bottom,
 * like text. Plain arrows move the focus, Shift+arrows extend the
 * selection, and Ctrl/Cmd+arrows move the selected pages: the same keys
 * presentation editors use for their slide sorters.
 */
import type { KeyInput } from "@/tools/edit/core/keyboard";

/** A direction to move the focus or the selection in. */
export type GridStep = "previous" | "next" | "up" | "down" | "first" | "last";

/** What a key press asks the board to do. */
export type BoardKeyCommand =
  /** Move the focus; with `extend`, select from the anchor to it. */
  | { type: "focus"; step: GridStep; extend: boolean }
  /** Move the selected pages. */
  | { type: "move"; step: GridStep }
  /** Select or deselect the focused page. */
  | { type: "toggle" }
  | { type: "select-all" }
  | { type: "select-none" }
  | { type: "delete" }
  | { type: "undo" }
  | { type: "redo" };

const ARROW_STEPS: Record<string, GridStep> = {
  ArrowLeft: "previous",
  ArrowRight: "next",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "first",
  End: "last",
};

/**
 * Map a key press to a board command.
 *
 * Ctrl (Windows, Linux) and Cmd (macOS) are treated alike. Keys typed into
 * a text field are ignored (the password field, for example), and so are
 * keys with Alt, which browsers use for their own shortcuts (Alt+Left is
 * "Back").
 *
 * | Keys                      | Command                          |
 * | ------------------------- | -------------------------------- |
 * | Arrows, Home, End         | move focus                       |
 * | Shift + those             | move focus, extend the selection |
 * | Ctrl/Cmd + those          | move the selected pages          |
 * | Space                     | select / deselect focused page   |
 * | Ctrl/Cmd+A                | select all                       |
 * | Escape                    | select none                      |
 * | Delete, Backspace         | delete the selected pages        |
 * | Ctrl/Cmd+Z                | undo                             |
 * | Ctrl/Cmd+Shift+Z, Ctrl+Y  | redo                             |
 *
 * @param input The key and modifiers (`altKey` is optional for callers
 *   that never have it).
 * @returns The command, or `null` when the key means nothing here.
 */
export function boardCommandForKey(
  input: KeyInput & { altKey?: boolean },
): BoardKeyCommand | null {
  if (input.inField || input.altKey) return null;
  const mod = input.ctrlKey || input.metaKey;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (mod && key === "z") return { type: input.shiftKey ? "redo" : "undo" };
  if (mod && key === "y") return { type: "redo" };
  if (mod && key === "a") return { type: "select-all" };
  const step = ARROW_STEPS[key];
  if (step) {
    return mod
      ? { type: "move", step }
      : { type: "focus", step, extend: input.shiftKey };
  }
  if (mod) return null;
  if (key === " ") return { type: "toggle" };
  if (key === "Escape") return { type: "select-none" };
  if (key === "Delete" || key === "Backspace") return { type: "delete" };
  return null;
}

/**
 * Commands that make sense wherever the focus is on the page (a toolbar
 * button, say), as opposed to those that need a focused page.
 *
 * @param command A board command.
 * @returns `true` for undo, redo and delete.
 */
export function isGlobalCommand(command: BoardKeyCommand): boolean {
  return (
    command.type === "undo" ||
    command.type === "redo" ||
    command.type === "delete"
  );
}

/**
 * The index a step leads to in a grid of `count` items laid out in rows of
 * `columns`.
 *
 * Left and right walk the reading order (the end of one row continues at
 * the start of the next); up and down jump a whole row. Every result is
 * clamped to the grid, so "down" on the last row goes to the last item
 * instead of nowhere.
 *
 * @param index The current index.
 * @param count Number of items.
 * @param columns Items per row (at least 1 is assumed).
 * @param step The direction.
 * @returns The target index, 0..count-1 (0 for an empty grid).
 */
export function stepIndex(
  index: number,
  count: number,
  columns: number,
  step: GridStep,
): number {
  if (count <= 0) return 0;
  const cols = Math.max(1, Math.trunc(columns) || 1);
  const target =
    step === "previous"
      ? index - 1
      : step === "next"
        ? index + 1
        : step === "up"
          ? index - cols
          : step === "down"
            ? index + cols
            : step === "first"
              ? 0
              : count - 1;
  return Math.min(count - 1, Math.max(0, target));
}

/**
 * How many places a "move" step moves the selection (see `moveKeysBy`).
 *
 * @param step The direction.
 * @param columns Items per row.
 * @param count Number of pages (a jump to either end never needs more).
 * @returns The signed number of places.
 */
export function moveDelta(
  step: GridStep,
  columns: number,
  count: number,
): number {
  const cols = Math.max(1, Math.trunc(columns) || 1);
  switch (step) {
    case "previous":
      return -1;
    case "next":
      return 1;
    case "up":
      return -cols;
    case "down":
      return cols;
    case "first":
      return -count;
    case "last":
      return count;
  }
}
