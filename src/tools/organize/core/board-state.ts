/**
 * The page organizer's state and its pure transitions.
 *
 * Undo and redo reuse the PDF editor's generic `History` (`commit`, `undo`,
 * `redo`): the undoable value is the board's page list. Every operation in
 * `arrange.ts` returns the same array when it changes nothing, and `commit`
 * ignores a value that is already present, so no-op actions never create
 * empty undo steps.
 */
import {
  commit,
  createHistory,
  redo,
  undo,
  type History,
} from "@/tools/edit/core/history";
import {
  duplicateKeys,
  insertAt,
  interleaveOrder,
  moveKeysBy,
  moveKeysTo,
  permuteSlots,
  removeKeys,
  reverseOrder,
  rotateKeys,
  turnLandscapeUpright,
} from "./arrange";
import {
  A4,
  MAX_BOARD_PAGES,
  clampPageSide,
  displayedSize,
  pagesOfSource,
  sourceMap,
  type BlankPage,
  type BoardPage,
  type BoardSource,
} from "./board";
import {
  EMPTY_SELECTION,
  pruneSelection,
  selectKeys,
  selectPage,
  selectedInOrder,
  type BoardSelection,
  type SelectMode,
} from "./selection";

/** Everything the organizer reducer owns. */
export interface BoardState {
  /** Opened files, in the order they were added (not undoable). */
  sources: readonly BoardSource[];
  /** The output pages, in order (undoable). */
  history: History<readonly BoardPage[]>;
  /** Selected pages (not undoable). */
  selection: BoardSelection;
  /**
   * Number for the next page key. It only ever grows, so a key is never
   * reused, not even by a page created after an undo.
   */
  nextKey: number;
}

/** The actions that reorder pages within a scope (see {@link arrangeScope}). */
export type ArrangeKind = "interleave" | "reverse" | "turn-landscape";

export type BoardAction =
  /** A file was opened: append all its pages to the board. */
  | { type: "add-source"; source: BoardSource }
  /** Close every file and empty the board. */
  | { type: "clear" }
  | { type: "select"; key: string; mode: SelectMode }
  | { type: "select-all" }
  /** Select every page of one file that is on the board. */
  | { type: "select-source"; sourceId: string }
  | { type: "select-none" }
  /** Move pages (a drag) to a gap; they end up selected. */
  | { type: "move-to"; keys: readonly string[]; gap: number }
  /** Move the selection by `delta` places (keyboard, buttons). */
  | { type: "move-by"; delta: number }
  | { type: "rotate"; delta: 1 | -1 }
  | { type: "delete" }
  | { type: "duplicate" }
  /** Insert a blank page after the selection (or at the end). */
  | { type: "insert-blank" }
  | { type: ArrangeKind }
  | { type: "undo" }
  | { type: "redo" };

/** State before any file is opened. */
export const EMPTY_BOARD_STATE: BoardState = {
  sources: [],
  history: createHistory<readonly BoardPage[]>([]),
  selection: EMPTY_SELECTION,
  nextKey: 1,
};

/**
 * How many selected pages make an arrange action work on the selection
 * instead of the whole board. Interleaving or reversing one page would do
 * nothing, so those need two; turning landscape pages works on one.
 */
export const ARRANGE_MINIMUM: Record<ArrangeKind, number> = {
  interleave: 2,
  reverse: 2,
  "turn-landscape": 1,
};

/**
 * The pages an arrange action applies to: the selection when it has at
 * least `minimum` pages, otherwise every page. The UI labels the buttons
 * from `selectionOnly` ("Reverse selected" or "Reverse all"), so the user
 * always knows which it is.
 *
 * @param pages The board pages.
 * @param selection The selection.
 * @param minimum Smallest selection that counts.
 * @returns The keys in scope and whether that is the selection.
 */
export function arrangeScope(
  pages: readonly BoardPage[],
  selection: BoardSelection,
  minimum: number,
): { keys: ReadonlySet<string>; selectionOnly: boolean } {
  const selected = pages.filter((p) => selection.keys.has(p.key));
  return selected.length >= minimum
    ? { keys: new Set(selected.map((p) => p.key)), selectionOnly: true }
    : { keys: new Set(pages.map((p) => p.key)), selectionOnly: false };
}

/**
 * Where "Insert blank page" puts the page, and which page it copies the
 * size of.
 *
 * The new page goes right after the last selected page, or at the end when
 * nothing is selected. Its neighbour is the page just before it (the first
 * page when inserting at the very start, which cannot happen here but keeps
 * the function total).
 *
 * @param pages The board pages.
 * @param selection The selection.
 * @returns The gap and the neighbour (`undefined` on an empty board).
 */
export function blankInsertion(
  pages: readonly BoardPage[],
  selection: BoardSelection,
): { gap: number; neighbour: BoardPage | undefined } {
  let last = -1;
  pages.forEach((p, i) => {
    if (selection.keys.has(p.key)) last = i;
  });
  const gap = last >= 0 ? last + 1 : pages.length;
  return { gap, neighbour: pages[gap - 1] ?? pages[0] };
}

/**
 * Commit a new page list (and an optional new selection), then prune the
 * selection to pages that still exist.
 *
 * @param state Current state.
 * @param pages The new page list (the present one means "no change").
 * @param selection The selection to use afterwards (default: unchanged).
 * @param nextKey The key counter after the change (default: unchanged).
 * @returns The new state, or `state` itself when nothing changed.
 */
function commitPages(
  state: BoardState,
  pages: readonly BoardPage[],
  selection: BoardSelection = state.selection,
  nextKey: number = state.nextKey,
): BoardState {
  if (pages === state.history.present && selection === state.selection)
    return state;
  const history = commit(state.history, pages);
  return {
    ...state,
    history,
    nextKey,
    selection: pruneSelection(
      selection,
      history.present.map((p) => p.key),
    ),
  };
}

/**
 * A key factory over the state's counter: `make()` returns "k<n>" and
 * counts up; `next` is the counter to store afterwards.
 *
 * @param state The state whose counter to start from.
 * @returns The factory.
 */
function keyFactory(state: BoardState): { make(): string; next(): number } {
  let n = state.nextKey;
  return { make: () => `k${n++}`, next: () => n };
}

/**
 * Pure state transitions for the organizer.
 *
 * Every change to the page list goes through `commit`, so it can be undone.
 * Actions that would change nothing (rotating with nothing selected,
 * deleting every page, going over {@link MAX_BOARD_PAGES}) return the same
 * state object, which lets React skip the render.
 *
 * @param state Current state.
 * @param action What happened.
 * @returns The next state.
 */
export function boardReducer(
  state: BoardState,
  action: BoardAction,
): BoardState {
  const pages = state.history.present;
  const order = pages.map((p) => p.key);
  const selected = state.selection.keys;

  switch (action.type) {
    case "add-source": {
      const { source } = action;
      if (state.sources.some((s) => s.id === source.id)) return state;
      if (pages.length + source.pages.length > MAX_BOARD_PAGES) return state;
      const keys = keyFactory(state);
      const added = pagesOfSource(source.id, source.pages.length, keys.make);
      return {
        ...commitPages(
          state,
          [...pages, ...added],
          state.selection,
          keys.next(),
        ),
        sources: [...state.sources, source],
      };
    }

    case "clear":
      return EMPTY_BOARD_STATE;

    case "select": {
      const selection = selectPage(
        state.selection,
        order,
        action.key,
        action.mode,
      );
      return selection === state.selection ? state : { ...state, selection };
    }

    case "select-all":
      return { ...state, selection: selectKeys(order, state.selection.anchor) };

    case "select-source":
      return {
        ...state,
        selection: selectKeys(
          pages
            .filter(
              (p) => p.kind === "source" && p.sourceId === action.sourceId,
            )
            .map((p) => p.key),
        ),
      };

    case "select-none":
      return state.selection.keys.size === 0 && state.selection.anchor === null
        ? state
        : { ...state, selection: EMPTY_SELECTION };

    case "move-to": {
      const keys = new Set(action.keys);
      const moved = moveKeysTo(pages, keys, action.gap);
      const movedKeys = order.filter((k) => keys.has(k));
      // The dragged pages end up selected, so a follow-up action (rotate,
      // move again with the keyboard) applies to them.
      return commitPages(state, moved, selectKeys(movedKeys));
    }

    case "move-by":
      return commitPages(state, moveKeysBy(pages, selected, action.delta));

    case "rotate":
      return commitPages(state, rotateKeys(pages, selected, action.delta));

    case "delete":
      return commitPages(state, removeKeys(pages, selected));

    case "duplicate": {
      if (pages.length + selected.size > MAX_BOARD_PAGES) return state;
      const keys = keyFactory(state);
      const { pages: next, created } = duplicateKeys(
        pages,
        selected,
        keys.make,
      );
      if (created.length === 0) return state;
      // Select the copies: they are what the user just made.
      return commitPages(state, next, selectKeys(created), keys.next());
    }

    case "insert-blank": {
      if (pages.length === 0 || pages.length >= MAX_BOARD_PAGES) return state;
      const { gap, neighbour } = blankInsertion(pages, state.selection);
      const size =
        (neighbour && displayedSize(neighbour, sourceMap(state.sources))) ?? A4;
      const keys = keyFactory(state);
      const blank: BlankPage = {
        kind: "blank",
        key: keys.make(),
        width: clampPageSide(size.width, A4.width),
        height: clampPageSide(size.height, A4.height),
        rotation: 0,
      };
      return commitPages(
        state,
        insertAt(pages, gap, blank),
        selectKeys([blank.key]),
        keys.next(),
      );
    }

    case "interleave":
    case "reverse": {
      const { keys } = arrangeScope(
        pages,
        state.selection,
        ARRANGE_MINIMUM[action.type],
      );
      const permute =
        action.type === "interleave" ? interleaveOrder : reverseOrder;
      return commitPages(state, permuteSlots(pages, keys, permute));
    }

    case "turn-landscape": {
      const { keys } = arrangeScope(
        pages,
        state.selection,
        ARRANGE_MINIMUM["turn-landscape"],
      );
      const sources = sourceMap(state.sources);
      return commitPages(
        state,
        turnLandscapeUpright(pages, keys, (p) => displayedSize(p, sources)),
      );
    }

    case "undo":
    case "redo": {
      const history =
        action.type === "undo" ? undo(state.history) : redo(state.history);
      if (history === state.history) return state;
      return {
        ...state,
        history,
        selection: pruneSelection(
          state.selection,
          history.present.map((p) => p.key),
        ),
      };
    }
  }
}

/**
 * The selected pages' keys in board order (for dragging and labels).
 *
 * @param state The organizer state.
 * @returns The keys, first page first.
 */
export function selectedKeys(state: BoardState): string[] {
  return selectedInOrder(
    state.history.present.map((p) => p.key),
    state.selection,
  );
}
