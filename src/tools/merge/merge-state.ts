import type { FailureReason, InspectResult } from "./messages";

/** Where one file is, from the UI's point of view. */
export type FileStatus =
  /** Waiting to be checked. `password` is set after the user typed one. */
  | { kind: "queued"; password?: string }
  | { kind: "checking"; password?: string }
  /** Opens fine; `password` (if any) is the one that opened it. */
  | { kind: "ready"; pageCount: number; password?: string }
  /**
   * Encrypted with a user password. `wrong`: the last one typed was wrong.
   * `dismissed`: the user skipped the prompt (it reopens on request).
   */
  | { kind: "needs-password"; wrong: boolean; dismissed: boolean }
  | { kind: "error"; reason: FailureReason; message: string };

export interface MergeItem {
  id: string;
  file: File;
  status: FileStatus;
}

/** The merge itself. */
export type MergeOutcome =
  | { kind: "idle" }
  | { kind: "merging" }
  | { kind: "done"; pdf: Blob; pageCount: number; warnings?: string }
  | { kind: "error"; reason: FailureReason; message: string };

export interface MergeState {
  /** In merge order. */
  items: MergeItem[];
  outcome: MergeOutcome;
}

export type MergeAction =
  | { type: "add"; items: { id: string; file: File }[] }
  | { type: "check-started"; id: string }
  | { type: "checked"; id: string; result: InspectResult }
  | { type: "submit-password"; id: string; password: string }
  | { type: "dismiss-password"; id: string }
  | { type: "reopen-password"; id: string }
  /** Move one place up (-1) or down (+1). */
  | { type: "move"; id: string; offset: -1 | 1 }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "merge-started" }
  | { type: "merge-succeeded"; pdf: Blob; warnings?: string }
  | { type: "merge-failed"; reason: FailureReason; message: string };

export const INITIAL_MERGE_STATE: MergeState = {
  items: [],
  outcome: { kind: "idle" },
};

/** Why the Merge button is disabled, if it is. */
export type MergeBlocker =
  /** Fewer than two files. */
  | "too-few"
  /** Some files have not been checked yet. */
  | "checking"
  /** Some files still need their password. */
  | "locked"
  /** Some files cannot be opened. */
  | "unreadable";

export interface MergeSummary {
  fileCount: number;
  /** Pages of the files checked so far. */
  pageCount: number;
  totalBytes: number;
  /** Undefined when merging may start. */
  blocker?: MergeBlocker;
}

/**
 * Count the files and pages, and say whether merging may start.
 *
 * Blockers are checked in the order a user would fix them: add files, wait
 * for the checks, type passwords, remove unreadable files.
 *
 * @param items The list.
 * @returns The summary.
 */
export function mergeSummary(items: readonly MergeItem[]): MergeSummary {
  let pageCount = 0;
  let totalBytes = 0;
  for (const { file, status } of items) {
    totalBytes += file.size;
    if (status.kind === "ready") pageCount += status.pageCount;
  }
  const has = (kind: FileStatus["kind"]) =>
    items.some((i) => i.status.kind === kind);
  const blocker: MergeBlocker | undefined =
    items.length < 2
      ? "too-few"
      : has("queued") || has("checking")
        ? "checking"
        : has("needs-password")
          ? "locked"
          : has("error")
            ? "unreadable"
            : undefined;
  return { fileCount: items.length, pageCount, totalBytes, blocker };
}

/**
 * Pick the file to check next. Files are checked one at a time, so memory use
 * stays predictable however many files are dropped at once.
 *
 * @param items The list.
 * @returns The first queued file, or `undefined` while one is being checked
 *   or when none is waiting.
 */
export function nextToCheck(
  items: readonly MergeItem[],
): (MergeItem & { status: { kind: "queued" } }) | undefined {
  if (items.some((i) => i.status.kind === "checking")) return undefined;
  return items.find(
    (i): i is MergeItem & { status: { kind: "queued" } } =>
      i.status.kind === "queued",
  );
}

/**
 * Turn the worker's answer about one file into its status.
 *
 * @param result What inspecting the file found.
 * @param password The password it was checked with, if any.
 * @returns The new status.
 */
export function statusFromInspection(
  result: InspectResult,
  password: string | undefined,
): FileStatus {
  switch (result.status) {
    case "inspected":
      return { kind: "ready", pageCount: result.pageCount, password };
    case "password-required":
      return { kind: "needs-password", wrong: false, dismissed: false };
    case "wrong-password":
      return { kind: "needs-password", wrong: true, dismissed: false };
    case "error":
      return { kind: "error", reason: result.reason, message: result.message };
  }
}

/**
 * Replace one item's status.
 *
 * @param state Current state.
 * @param id The item.
 * @param update Returns the new status, or `undefined` to leave it as is.
 * @returns The new state, or the same object when nothing changed.
 */
function updateItem(
  state: MergeState,
  id: string,
  update: (item: MergeItem) => FileStatus | undefined,
): MergeState {
  const index = state.items.findIndex((i) => i.id === id);
  if (index < 0) return state;
  const status = update(state.items[index]);
  if (!status) return state;
  const items = state.items.slice();
  items[index] = { ...items[index], status };
  return { ...state, items };
}

/**
 * Mark a finished merge (or its error) as out of date after the list changed.
 * Offering that PDF would hand the user a file that no longer matches the
 * list on screen.
 *
 * @param outcome The current outcome.
 * @returns "idle" instead of a finished result; anything else unchanged.
 */
function staleOutcome(outcome: MergeOutcome): MergeOutcome {
  return outcome.kind === "done" || outcome.kind === "error"
    ? { kind: "idle" }
    : outcome;
}

/**
 * Apply a list change, and mark any finished merge as out of date.
 *
 * @param state Current state.
 * @param items The new list.
 * @returns The new state.
 */
function withItems(state: MergeState, items: MergeItem[]): MergeState {
  return { items, outcome: staleOutcome(state.outcome) };
}

/**
 * Pure state transitions for Merge PDFs.
 *
 * Rules, and why:
 * - While merging, the list is locked: every action that would change it is
 *   ignored, so the PDF that comes back always matches the list on screen
 *   (the UI disables those controls too; the reducer is the guarantee).
 * - Anything that changes what would be merged (adding, removing,
 *   reordering, typing a password) drops a finished PDF or merge error, for
 *   the reason given in `staleOutcome`. Opening or skipping the password
 *   prompt changes nothing that is merged, so it keeps them.
 * - "checked" only applies to a file that is still being checked: the file
 *   may have been removed while its check ran.
 * - "merge-started" only applies when `mergeSummary` has no blocker; the
 *   success and failure of a merge only apply while one is running.
 * Unchanged state is returned as the same object, so callers can tell that
 * an action was ignored and React can skip a render.
 *
 * @param state Current state.
 * @param action What happened.
 * @returns The next state.
 */
export function mergeReducer(
  state: MergeState,
  action: MergeAction,
): MergeState {
  const locked = state.outcome.kind === "merging";
  switch (action.type) {
    case "add": {
      if (locked || action.items.length === 0) return state;
      const added = action.items.map(({ id, file }) => ({
        id,
        file,
        status: { kind: "queued" } as const,
      }));
      return withItems(state, [...state.items, ...added]);
    }
    case "check-started":
      return updateItem(state, action.id, ({ status }) =>
        status.kind === "queued"
          ? { kind: "checking", password: status.password }
          : undefined,
      );
    case "checked":
      return updateItem(state, action.id, ({ status }) =>
        status.kind === "checking"
          ? statusFromInspection(action.result, status.password)
          : undefined,
      );
    case "submit-password": {
      if (locked) return state;
      const next = updateItem(state, action.id, ({ status }) =>
        status.kind === "needs-password"
          ? { kind: "queued", password: action.password }
          : undefined,
      );
      return next === state ? state : withItems(next, next.items);
    }
    case "dismiss-password":
    case "reopen-password": {
      const dismissed = action.type === "dismiss-password";
      return updateItem(state, action.id, ({ status }) =>
        status.kind === "needs-password" && status.dismissed !== dismissed
          ? { ...status, dismissed }
          : undefined,
      );
    }
    case "move": {
      if (locked) return state;
      const from = state.items.findIndex((i) => i.id === action.id);
      const to = from + action.offset;
      if (from < 0 || to < 0 || to >= state.items.length) return state;
      const items = state.items.slice();
      [items[from], items[to]] = [items[to], items[from]];
      return withItems(state, items);
    }
    case "remove": {
      if (locked || !state.items.some((i) => i.id === action.id)) return state;
      return withItems(
        state,
        state.items.filter((i) => i.id !== action.id),
      );
    }
    case "clear":
      return locked || state.items.length === 0 ? state : INITIAL_MERGE_STATE;
    case "merge-started":
      return locked || mergeSummary(state.items).blocker
        ? state
        : { ...state, outcome: { kind: "merging" } };
    case "merge-succeeded":
      return locked
        ? {
            ...state,
            outcome: {
              kind: "done",
              pdf: action.pdf,
              pageCount: mergeSummary(state.items).pageCount,
              warnings: action.warnings,
            },
          }
        : state;
    case "merge-failed":
      return locked
        ? {
            ...state,
            outcome: {
              kind: "error",
              reason: action.reason,
              message: action.message,
            },
          }
        : state;
  }
}
