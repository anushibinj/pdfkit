import type { Point } from "./model";

/** What a key press asks the editor to do. */
export type KeyCommand =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "escape" }
  /** Move the selected object by this many points on screen. */
  | { type: "nudge"; delta: Point };

/** The parts of a `KeyboardEvent` the mapping looks at. */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** True when the key went to a text field, select or editable element. */
  inField: boolean;
}

/** Points moved per arrow key press (with Shift: {@link NUDGE_LARGE}). */
export const NUDGE_SMALL = 1;
export const NUDGE_LARGE = 10;

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Decide whether an element is something the user types into, where the
 * editor must leave keys alone (Backspace deletes a character there, not
 * the selected object; Ctrl+Z undoes typing there).
 *
 * @param target The event target.
 * @returns `true` for inputs, text areas, selects and editable content.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") return false;
  const el = target as HTMLElement;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * Map a key press to an editor command.
 *
 * Ctrl (Windows, Linux) and Cmd (macOS) are treated alike. Redo is
 * Ctrl+Shift+Z everywhere and also Ctrl+Y, the Windows convention. Escape
 * always counts, even in a field, so it can leave a text box; every other
 * key is ignored inside fields.
 *
 * @param input The key and modifiers.
 * @returns The command, or `null` when the key means nothing here.
 */
export function commandForKey(input: KeyInput): KeyCommand | null {
  if (input.key === "Escape") return { type: "escape" };
  if (input.inField) return null;
  const mod = input.ctrlKey || input.metaKey;
  const key = input.key.toLowerCase();
  if (mod && key === "z") return { type: input.shiftKey ? "redo" : "undo" };
  if (mod && key === "y") return { type: "redo" };
  if (mod) return null;
  if (input.key === "Delete" || input.key === "Backspace")
    return { type: "delete" };
  const arrow = ARROWS[input.key];
  if (arrow) {
    const step = input.shiftKey ? NUDGE_LARGE : NUDGE_SMALL;
    return { type: "nudge", delta: { x: arrow.x * step, y: arrow.y * step } };
  }
  return null;
}
