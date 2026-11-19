import { describe, expect, it } from "vitest";
import {
  EMPTY_EDITOR_STATE,
  createDocument,
  editorReducer,
  findObject,
  type EditorAction,
  type EditorState,
} from "./editor-state";
import type { RectObject, TextObject } from "./model";

const text: TextObject = {
  id: "t1",
  kind: "text",
  x: 10,
  y: 20,
  rotation: 0,
  text: "Hi",
  font: "sans",
  fontSize: 12,
  color: { r: 0, g: 0, b: 0 },
};
const rect: RectObject = {
  id: "r1",
  kind: "rect",
  x: 0,
  y: 0,
  rotation: 0,
  width: 10,
  height: 10,
  color: { r: 255, g: 0, b: 0 },
  strokeWidth: 2,
};

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);
const loaded = (pages = 3) =>
  editorReducer(EMPTY_EDITOR_STATE, { type: "load", pageCount: pages });
const doc = (s: EditorState) => s.history.present;

describe("createDocument", () => {
  it("lists the file's pages in order, unrotated and empty", () => {
    expect(createDocument(2)).toEqual({
      pages: [
        { key: "p0", sourceIndex: 0, rotation: 0, objects: [] },
        { key: "p1", sourceIndex: 1, rotation: 0, objects: [] },
      ],
    });
  });
});

describe("findObject", () => {
  it("finds the selected object and nothing for stale selections", () => {
    const s = run(loaded(), {
      type: "add-object",
      pageKey: "p1",
      object: text,
    });
    expect(findObject(doc(s), { pageKey: "p1", objectId: "t1" })).toBe(text);
    expect(
      findObject(doc(s), { pageKey: "p0", objectId: "t1" }),
    ).toBeUndefined();
    expect(findObject(doc(s), null)).toBeUndefined();
  });
});

describe("editorReducer", () => {
  it("load: starts a fresh, unmodified history", () => {
    const s = loaded(2);
    expect(doc(s).pages).toHaveLength(2);
    expect(s.history.past).toEqual([]);
    expect(s.selection).toBeNull();
  });

  it("add-object: appends on top and selects it", () => {
    const s = run(
      loaded(),
      { type: "add-object", pageKey: "p0", object: rect },
      { type: "add-object", pageKey: "p0", object: text },
    );
    expect(doc(s).pages[0].objects.map((o) => o.id)).toEqual(["r1", "t1"]);
    expect(s.selection).toEqual({ pageKey: "p0", objectId: "t1" });
    expect(s.history.past).toHaveLength(2);
  });

  it("add-object: can leave the new object unselected", () => {
    const s = run(
      loaded(),
      { type: "add-object", pageKey: "p0", object: rect },
      { type: "add-object", pageKey: "p0", object: text, select: false },
    );
    expect(doc(s).pages[0].objects).toHaveLength(2);
    expect(s.selection).toBeNull();
  });

  it("add-object: ignores unknown pages", () => {
    const s = loaded();
    expect(
      editorReducer(s, { type: "add-object", pageKey: "nope", object: text }),
    ).toBe(s);
  });

  it("update-object: merges the patch but never changes id or kind", () => {
    const s = run(
      loaded(),
      { type: "add-object", pageKey: "p0", object: text },
      {
        type: "update-object",
        pageKey: "p0",
        objectId: "t1",
        patch: { text: "Hello", id: "evil", kind: "rect" } as never,
      },
    );
    expect(doc(s).pages[0].objects[0]).toEqual({ ...text, text: "Hello" });
  });

  it("update-object: coalesces typing into one undo step", () => {
    let s = run(loaded(), { type: "add-object", pageKey: "p0", object: text });
    for (const value of ["H", "He", "Hey"]) {
      s = editorReducer(s, {
        type: "update-object",
        pageKey: "p0",
        objectId: "t1",
        patch: { text: value },
        coalesceKey: "text:t1",
      });
    }
    expect((doc(s).pages[0].objects[0] as TextObject).text).toBe("Hey");
    s = editorReducer(s, { type: "undo" });
    expect((doc(s).pages[0].objects[0] as TextObject).text).toBe("Hi");
  });

  it("update-object: unknown objects change nothing", () => {
    const s = loaded();
    expect(
      editorReducer(s, {
        type: "update-object",
        pageKey: "p0",
        objectId: "x",
        patch: { x: 1 },
      }),
    ).toBe(s);
  });

  it("remove-object: deletes it and clears its selection", () => {
    const s = run(
      loaded(),
      { type: "add-object", pageKey: "p0", object: text },
      { type: "remove-object", pageKey: "p0", objectId: "t1" },
    );
    expect(doc(s).pages[0].objects).toEqual([]);
    expect(s.selection).toBeNull();
  });

  it("select: sets and clears the selection without touching history", () => {
    let s = run(loaded(), { type: "add-object", pageKey: "p0", object: text });
    const past = s.history.past;
    s = editorReducer(s, { type: "select", selection: null });
    expect(s.selection).toBeNull();
    s = editorReducer(s, {
      type: "select",
      selection: { pageKey: "p0", objectId: "t1" },
    });
    expect(s.selection).toEqual({ pageKey: "p0", objectId: "t1" });
    expect(s.history.past).toBe(past);
    expect(
      editorReducer(s, {
        type: "select",
        selection: { pageKey: "p0", objectId: "t1" },
      }),
    ).toBe(s);
    // selecting something that does not exist selects nothing
    expect(
      editorReducer(s, {
        type: "select",
        selection: { pageKey: "p0", objectId: "zz" },
      }).selection,
    ).toBeNull();
  });

  it("rotate-page: wraps around in both directions", () => {
    let s = run(loaded(), { type: "rotate-page", pageKey: "p1", delta: -1 });
    expect(doc(s).pages[1].rotation).toBe(3);
    s = run(s, { type: "rotate-page", pageKey: "p1", delta: 1 });
    expect(doc(s).pages[1].rotation).toBe(0);
    expect(s.history.past).toHaveLength(2);
  });

  it("move-page: swaps neighbours and stops at the ends", () => {
    let s = run(loaded(), { type: "move-page", pageKey: "p2", delta: -1 });
    expect(doc(s).pages.map((p) => p.key)).toEqual(["p0", "p2", "p1"]);
    const base = loaded();
    expect(
      editorReducer(base, { type: "move-page", pageKey: "p0", delta: -1 }),
    ).toBe(base);
    expect(
      editorReducer(base, { type: "move-page", pageKey: "p2", delta: 1 }),
    ).toBe(base);
    s = run(s, { type: "move-page", pageKey: "p2", delta: 1 });
    expect(doc(s).pages.map((p) => p.key)).toEqual(["p0", "p1", "p2"]);
  });

  it("delete-page: removes the page and any selection on it", () => {
    const s = run(
      loaded(),
      { type: "add-object", pageKey: "p1", object: text },
      { type: "delete-page", pageKey: "p1" },
    );
    expect(doc(s).pages.map((p) => p.key)).toEqual(["p0", "p2"]);
    expect(s.selection).toBeNull();
  });

  it("delete-page: keeps the last remaining page", () => {
    const s = loaded(1);
    expect(editorReducer(s, { type: "delete-page", pageKey: "p0" })).toBe(s);
  });

  it("undo and redo walk the history and drop stale selections", () => {
    let s = run(loaded(), { type: "add-object", pageKey: "p0", object: text });
    s = editorReducer(s, { type: "undo" });
    expect(doc(s).pages[0].objects).toEqual([]);
    expect(s.selection).toBeNull();
    s = editorReducer(s, { type: "redo" });
    expect(doc(s).pages[0].objects).toEqual([text]);
  });
});
