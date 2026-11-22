/**
 * Undo/redo history for an immutable value.
 *
 * `past` holds older values (most recent last), `future` holds values that
 * were undone (next redo last). `coalesceKey` remembers what produced
 * `present`, so a run of similar edits (typing into one text box) can share
 * a single undo step.
 */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  readonly coalesceKey?: string;
}

/** How many undo steps are kept; older ones are forgotten. */
export const HISTORY_LIMIT = 100;

/**
 * Start a history with nothing to undo or redo.
 *
 * @param present The initial value.
 * @returns A fresh history.
 */
export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Record a new value.
 *
 * Rules:
 * - Committing the value that is already present changes nothing (returns
 *   the same object), so no-op edits never create empty undo steps.
 * - If `coalesceKey` is given and equals the key of the previous commit, the
 *   present value is replaced instead of pushed. Typing "Hello" into a text
 *   box therefore undoes in one step, not five. Any other commit, undo or
 *   redo breaks the run.
 * - Every commit clears `future`: after a new edit, the undone branch is gone
 *   (the usual editor behaviour).
 * - `past` is capped at {@link HISTORY_LIMIT} entries, dropping the oldest.
 *
 * @param history The current history.
 * @param next The new value.
 * @param coalesceKey Optional key that groups consecutive commits.
 * @returns The updated history.
 */
export function commit<T>(
  history: History<T>,
  next: T,
  coalesceKey?: string,
): History<T> {
  if (next === history.present) return history;
  if (coalesceKey !== undefined && coalesceKey === history.coalesceKey) {
    return { past: history.past, present: next, future: [], coalesceKey };
  }
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], coalesceKey };
}

/**
 * Step back one value.
 *
 * @param history The current history.
 * @returns The history with the previous value present, or the same object
 *   when there is nothing to undo.
 */
export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const past = history.past.slice(0, -1);
  const present = history.past[history.past.length - 1];
  return { past, present, future: [...history.future, history.present] };
}

/**
 * Step forward again after an undo.
 *
 * @param history The current history.
 * @returns The history with the next value present, or the same object when
 *   there is nothing to redo.
 */
export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const future = history.future.slice(0, -1);
  const present = history.future[history.future.length - 1];
  return { past: [...history.past, history.present], present, future };
}
