import { commit, createHistory, redo, undo, type History } from "@/lib/history";
import type { EditObject, EditorDocument, EditorPage } from "./model";
import { addTurns } from "./page-geometry";

/** The selected object, identified by its page and id. */
export interface Selection {
  pageKey: string;
  objectId: string;
}

/** Everything the editor reducer owns. */
export interface EditorState {
  /** Undoable document: page order, page rotations and objects. */
  history: History<EditorDocument>;
  /** Not undoable: selecting is not an edit. */
  selection: Selection | null;
}

/** `Omit` that works per member of a union (the built-in one does not). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Fields of one object to change. `id` and `kind` can never change. */
export type ObjectPatch = Partial<DistributiveOmit<EditObject, "id" | "kind">>;

export type EditorAction =
  /** A file was opened: start over with its pages, untouched. */
  | { type: "load"; pageCount: number }
  | {
      type: "add-object";
      pageKey: string;
      object: EditObject;
      /**
       * Select the new object (default). Drawing tools pass `false` so the
       * panel keeps showing the tool's style while several strokes or
       * boxes are drawn in a row.
       */
      select?: boolean;
    }
  | {
      type: "update-object";
      pageKey: string;
      objectId: string;
      patch: ObjectPatch;
      /** Groups consecutive updates into one undo step (see `commit`). */
      coalesceKey?: string;
    }
  | { type: "remove-object"; pageKey: string; objectId: string }
  /**
   * Change a line of the page's own text. `original` is the line's text in
   * the file: setting the text back to it removes the edit.
   */
  | {
      type: "edit-text";
      pageKey: string;
      runId: string;
      text: string;
      original: string;
    }
  | { type: "select"; selection: Selection | null }
  /** Turn a page by `delta` clockwise quarter turns (negative: anticlockwise). */
  | { type: "rotate-page"; pageKey: string; delta: number }
  /** Move a page one place up (-1) or down (+1). */
  | { type: "move-page"; pageKey: string; delta: -1 | 1 }
  | { type: "delete-page"; pageKey: string }
  | { type: "undo" }
  | { type: "redo" };

/**
 * A document with the file's pages in their original order, unrotated,
 * without added objects and with their text unchanged.
 *
 * @param pageCount Number of pages in the opened file.
 * @returns The initial document.
 */
export function createDocument(pageCount: number): EditorDocument {
  return {
    pages: Array.from({ length: pageCount }, (_, i) => ({
      key: `p${i}`,
      sourceIndex: i,
      rotation: 0,
      objects: [],
      textEdits: {},
    })),
  };
}

/** State before any file is opened. */
export const EMPTY_EDITOR_STATE: EditorState = {
  history: createHistory(createDocument(0)),
  selection: null,
};

/**
 * Look up the object a selection points to.
 *
 * @param doc The document.
 * @param selection What is selected, if anything.
 * @returns The object, or `undefined` when nothing (or something deleted) is
 *   selected.
 */
export function findObject(
  doc: EditorDocument,
  selection: Selection | null,
): EditObject | undefined {
  if (!selection) return undefined;
  return doc.pages
    .find((p) => p.key === selection.pageKey)
    ?.objects.find((o) => o.id === selection.objectId);
}

/**
 * Apply `change` to the page with `pageKey` and commit the result.
 *
 * @param state Current state.
 * @param pageKey Page to change.
 * @param change Returns the new page, or the same page for "no change".
 * @param coalesceKey Optional undo grouping key.
 * @returns The new state (the same object when nothing changed).
 */
function changePage(
  state: EditorState,
  pageKey: string,
  change: (page: EditorPage) => EditorPage,
  coalesceKey?: string,
): EditorState {
  const doc = state.history.present;
  let changed = false;
  const pages = doc.pages.map((page) => {
    if (page.key !== pageKey) return page;
    const next = change(page);
    if (next !== page) changed = true;
    return next;
  });
  if (!changed) return state;
  return { ...state, history: commit(state.history, { pages }, coalesceKey) };
}

/**
 * Drop the selection if it points at something that no longer exists (after
 * an undo, a redo or a page deletion).
 *
 * @param state A state whose selection may be stale.
 * @returns The state with a valid selection.
 */
function withValidSelection(state: EditorState): EditorState {
  if (!state.selection) return state;
  return findObject(state.history.present, state.selection)
    ? state
    : { ...state, selection: null };
}

/**
 * Pure state transitions for the editor.
 *
 * Every document change goes through `commit`, so it can be undone. Actions
 * that would not change anything (moving the first page up, deleting the
 * last remaining page, updating an object that is gone) return the same
 * state object, which lets React skip the render and keeps empty steps out
 * of the undo history.
 *
 * @param state Current state.
 * @param action What happened.
 * @returns The next state.
 */
export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "load":
      return {
        history: createHistory(createDocument(action.pageCount)),
        selection: null,
      };

    case "add-object": {
      const next = changePage(state, action.pageKey, (page) => ({
        ...page,
        objects: [...page.objects, action.object],
      }));
      if (next === state) return state;
      return action.select === false
        ? { ...next, selection: null }
        : {
            ...next,
            selection: { pageKey: action.pageKey, objectId: action.object.id },
          };
    }

    case "update-object":
      return changePage(
        state,
        action.pageKey,
        (page) => {
          const index = page.objects.findIndex((o) => o.id === action.objectId);
          if (index < 0) return page;
          const old = page.objects[index];
          // id and kind are re-applied last so a patch can never change them.
          const updated = {
            ...old,
            ...action.patch,
            id: old.id,
            kind: old.kind,
          } as EditObject;
          const objects = [...page.objects];
          objects[index] = updated;
          return { ...page, objects };
        },
        action.coalesceKey,
      );

    case "remove-object":
      return withValidSelection(
        changePage(state, action.pageKey, (page) =>
          page.objects.some((o) => o.id === action.objectId)
            ? {
                ...page,
                objects: page.objects.filter((o) => o.id !== action.objectId),
              }
            : page,
        ),
      );

    case "edit-text":
      return changePage(state, action.pageKey, (page) => {
        const current = page.textEdits[action.runId];
        if (action.text === action.original) {
          // Back to the file's text: drop the edit instead of storing a no-op.
          if (current === undefined) return page;
          const rest = { ...page.textEdits };
          delete rest[action.runId];
          return { ...page, textEdits: rest };
        }
        if (current === action.text) return page;
        return {
          ...page,
          textEdits: { ...page.textEdits, [action.runId]: action.text },
        };
      });

    case "select": {
      const same =
        state.selection?.pageKey === action.selection?.pageKey &&
        state.selection?.objectId === action.selection?.objectId;
      return same
        ? state
        : withValidSelection({ ...state, selection: action.selection });
    }

    case "rotate-page":
      return changePage(state, action.pageKey, (page) => {
        const rotation = addTurns(page.rotation, action.delta);
        return rotation === page.rotation ? page : { ...page, rotation };
      });

    case "move-page": {
      const pages = state.history.present.pages;
      const from = pages.findIndex((p) => p.key === action.pageKey);
      const to = from + action.delta;
      if (from < 0 || to < 0 || to >= pages.length) return state;
      const reordered = [...pages];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
      return { ...state, history: commit(state.history, { pages: reordered }) };
    }

    case "delete-page": {
      const pages = state.history.present.pages;
      // A PDF needs at least one page, so the last one cannot be deleted.
      if (pages.length <= 1 || !pages.some((p) => p.key === action.pageKey))
        return state;
      const remaining = pages.filter((p) => p.key !== action.pageKey);
      return withValidSelection({
        ...state,
        history: commit(state.history, { pages: remaining }),
      });
    }

    case "undo":
      return withValidSelection({ ...state, history: undo(state.history) });

    case "redo":
      return withValidSelection({ ...state, history: redo(state.history) });
  }
}
