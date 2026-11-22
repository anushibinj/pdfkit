/**
 * Keyboard helpers shared by the tools whose pages take shortcuts (the PDF
 * editor, Organize Pages).
 */

/** The parts of a `KeyboardEvent` the mapping looks at. */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** True when the key went to a text field, select or editable element. */
  inField: boolean;
}

/**
 * Decide whether an element is something the user types into, where
 * shortcuts must leave keys alone (Backspace deletes a character there, not
 * the selection; Ctrl+Z undoes typing there).
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
