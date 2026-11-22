import { describe, expect, it } from "vitest";
import type { PageInfo } from "@/lib/pdfium/page-box";
import { A4, MAX_BOARD_PAGES, type BoardPage, type BoardSource } from "./board";
import {
  ARRANGE_MINIMUM,
  EMPTY_BOARD_STATE,
  arrangeScope,
  blankInsertion,
  boardReducer,
  selectedKeys,
  type BoardAction,
  type BoardState,
} from "./board-state";
import { EMPTY_SELECTION, selectKeys } from "./selection";

const portrait: PageInfo = {
  box: { left: 0, bottom: 0, right: 600, top: 800 },
  rotation: 0,
};
const landscape: PageInfo = {
  box: { left: 0, bottom: 0, right: 800, top: 600 },
  rotation: 0,
};

/** A source with the given page infos (default: n portrait pages). */
function source(id: string, pages: PageInfo[] | number = 3): BoardSource {
  return {
    id,
    name: `${id}.pdf`,
    colorIndex: 0,
    passwordProtected: false,
    pages: typeof pages === "number" ? Array(pages).fill(portrait) : pages,
  };
}

/** Run actions from an empty board. */
function run(...actions: BoardAction[]): BoardState {
  return actions.reduce(boardReducer, EMPTY_BOARD_STATE);
}

/** "file:page" labels of the board, e.g. "a0 a1 b0". */
function labels(state: BoardState): string {
  return state.history.present
    .map((p) => (p.kind === "source" ? `${p.sourceId}${p.pageIndex}` : "_"))
    .join(" ");
}

/** The key of the board page at `index`. */
const keyAt = (state: BoardState, index: number) =>
  state.history.present[index].key;

/** Select the pages at the given positions. */
function selectAt(state: BoardState, ...indices: number[]): BoardState {
  return indices.reduce(
    (s, i, n) =>
      boardReducer(s, {
        type: "select",
        key: keyAt(s, i),
        mode: n === 0 ? "only" : "toggle",
      }),
    state,
  );
}

describe("add-source", () => {
  it("appends the file's pages and keeps the source", () => {
    const s = run(
      { type: "add-source", source: source("a", 2) },
      { type: "add-source", source: source("b", 1) },
    );
    expect(labels(s)).toBe("a0 a1 b0");
    expect(s.sources.map((x) => x.id)).toEqual(["a", "b"]);
    expect(new Set(s.history.present.map((p) => p.key)).size).toBe(3);
  });

  it("is undoable, but the file stays open for redo", () => {
    let s = run(
      { type: "add-source", source: source("a", 1) },
      { type: "add-source", source: source("b", 1) },
      { type: "undo" },
    );
    expect(labels(s)).toBe("a0");
    expect(s.sources).toHaveLength(2);
    s = boardReducer(s, { type: "redo" });
    expect(labels(s)).toBe("a0 b0");
  });

  it("ignores a source id that is already open", () => {
    const s = run({ type: "add-source", source: source("a", 1) });
    expect(
      boardReducer(s, { type: "add-source", source: source("a", 4) }),
    ).toBe(s);
  });

  it("refuses a file that would exceed the page limit", () => {
    const s = run({ type: "add-source", source: source("a", MAX_BOARD_PAGES) });
    expect(
      boardReducer(s, { type: "add-source", source: source("b", 1) }),
    ).toBe(s);
  });
});

describe("clear", () => {
  it("returns to the empty state", () => {
    const s = run(
      { type: "add-source", source: source("a") },
      { type: "clear" },
    );
    expect(s).toBe(EMPTY_BOARD_STATE);
  });
});

describe("selection actions", () => {
  const base = run(
    { type: "add-source", source: source("a", 2) },
    { type: "add-source", source: source("b", 2) },
  );

  it("select, select-all and select-none", () => {
    let s = boardReducer(base, {
      type: "select",
      key: keyAt(base, 1),
      mode: "only",
    });
    expect(selectedKeys(s)).toEqual([keyAt(base, 1)]);
    s = boardReducer(s, { type: "select-all" });
    expect(selectedKeys(s)).toHaveLength(4);
    s = boardReducer(s, { type: "select-none" });
    expect(s.selection).toBe(EMPTY_SELECTION);
    expect(boardReducer(s, { type: "select-none" })).toBe(s);
  });

  it("select returns the same state when nothing changes", () => {
    const s = boardReducer(base, {
      type: "select",
      key: "missing",
      mode: "only",
    });
    expect(s).toBe(base);
  });

  it("select-source selects that file's pages only", () => {
    const s = boardReducer(base, { type: "select-source", sourceId: "b" });
    expect(selectedKeys(s)).toEqual([keyAt(base, 2), keyAt(base, 3)]);
  });

  it("selecting is not an undo step", () => {
    const s = boardReducer(base, { type: "select-all" });
    expect(s.history).toBe(base.history);
  });
});

describe("move-to and move-by", () => {
  const base = run({ type: "add-source", source: source("a", 4) });

  it("move-to moves the given pages and selects them", () => {
    const keys = [keyAt(base, 0), keyAt(base, 1)];
    const s = boardReducer(base, { type: "move-to", keys, gap: 4 });
    expect(labels(s)).toBe("a2 a3 a0 a1");
    expect(selectedKeys(s)).toEqual(keys);
    expect(labels(boardReducer(s, { type: "undo" }))).toBe("a0 a1 a2 a3");
  });

  it("move-to onto its own place only selects", () => {
    const s = boardReducer(base, {
      type: "move-to",
      keys: [keyAt(base, 1)],
      gap: 1,
    });
    expect(s.history).toBe(base.history);
    expect(selectedKeys(s)).toEqual([keyAt(base, 1)]);
  });

  it("move-by moves the selection", () => {
    const s = boardReducer(selectAt(base, 1), { type: "move-by", delta: 2 });
    expect(labels(s)).toBe("a0 a2 a3 a1");
  });

  it("move-by with nothing selected changes nothing", () => {
    expect(boardReducer(base, { type: "move-by", delta: 1 })).toBe(base);
  });
});

describe("rotate, delete, duplicate", () => {
  const base = run({ type: "add-source", source: source("a", 3) });

  it("rotate turns the selection", () => {
    const s = boardReducer(selectAt(base, 0, 2), { type: "rotate", delta: -1 });
    expect(s.history.present.map((p) => p.rotation)).toEqual([3, 0, 3]);
  });

  it("delete removes the selection and clears it", () => {
    const s = boardReducer(selectAt(base, 1), { type: "delete" });
    expect(labels(s)).toBe("a0 a2");
    expect(s.selection.keys.size).toBe(0);
  });

  it("delete refuses to empty the board", () => {
    const all = boardReducer(base, { type: "select-all" });
    expect(boardReducer(all, { type: "delete" })).toBe(all);
  });

  it("duplicate copies after each page and selects the copies", () => {
    const s = boardReducer(selectAt(base, 0, 2), { type: "duplicate" });
    expect(labels(s)).toBe("a0 a0 a1 a2 a2");
    expect(selectedKeys(s)).toEqual([keyAt(s, 1), keyAt(s, 4)]);
    expect(new Set(s.history.present.map((p) => p.key)).size).toBe(5);
  });

  it("duplicate with nothing selected changes nothing", () => {
    expect(boardReducer(base, { type: "duplicate" })).toBe(base);
  });

  it("duplicate refuses to go over the page limit", () => {
    const big = boardReducer(
      run({ type: "add-source", source: source("a", MAX_BOARD_PAGES) }),
      { type: "select-all" },
    );
    expect(boardReducer(big, { type: "duplicate" })).toBe(big);
  });

  it("keys are never reused, even after an undo", () => {
    let s = boardReducer(selectAt(base, 0), { type: "duplicate" });
    const firstCopy = keyAt(s, 1);
    s = boardReducer(s, { type: "undo" });
    s = boardReducer(selectAt(s, 0), { type: "duplicate" });
    expect(keyAt(s, 1)).not.toBe(firstCopy);
  });
});

describe("insert-blank", () => {
  it("inserts after the selection, sized like its neighbour", () => {
    let s = run({
      type: "add-source",
      source: source("a", [portrait, landscape, portrait]),
    });
    s = boardReducer(selectAt(s, 1), { type: "insert-blank" });
    expect(labels(s)).toBe("a0 a1 _ a2");
    const blank = s.history.present[2] as Extract<BoardPage, { kind: "blank" }>;
    expect([blank.width, blank.height]).toEqual([800, 600]);
    expect(selectedKeys(s)).toEqual([blank.key]);
  });

  it("copies the neighbour's displayed (rotated) size", () => {
    let s = run({ type: "add-source", source: source("a", [portrait]) });
    s = boardReducer(selectAt(s, 0), { type: "rotate", delta: 1 });
    s = boardReducer(s, { type: "insert-blank" });
    const blank = s.history.present[1] as Extract<BoardPage, { kind: "blank" }>;
    expect([blank.width, blank.height]).toEqual([800, 600]);
  });

  it("appends at the end when nothing is selected", () => {
    let s = run({ type: "add-source", source: source("a", 2) });
    s = boardReducer(s, { type: "insert-blank" });
    expect(labels(s)).toBe("a0 a1 _");
  });

  it("falls back to A4 for a corrupt neighbour box", () => {
    const corrupt: PageInfo = {
      box: { left: 0, bottom: 0, right: Number.NaN, top: Number.NaN },
      rotation: 0,
    };
    let s = run({ type: "add-source", source: source("a", [corrupt]) });
    s = boardReducer(s, { type: "insert-blank" });
    const blank = s.history.present[1] as Extract<BoardPage, { kind: "blank" }>;
    expect([blank.width, blank.height]).toEqual([A4.width, A4.height]);
  });

  it("does nothing on an empty board", () => {
    expect(boardReducer(EMPTY_BOARD_STATE, { type: "insert-blank" })).toBe(
      EMPTY_BOARD_STATE,
    );
  });
});

describe("interleave, reverse, turn-landscape", () => {
  it("interleave on the whole board restores a duplex scan of two files", () => {
    const s = run(
      { type: "add-source", source: source("f", 3) }, // fronts 1, 3, 5
      { type: "add-source", source: source("b", 3) }, // backs 6, 4, 2
      { type: "interleave" },
    );
    expect(labels(s)).toBe("f0 b2 f1 b1 f2 b0");
  });

  it("interleave works on the selection when 2+ pages are selected", () => {
    let s = run({ type: "add-source", source: source("a", 5) });
    // Scope: a1 a2 a3 a4 -> a1 a4 a2 a3 within those slots.
    s = selectAt(s, 1, 2, 3, 4);
    s = boardReducer(s, { type: "interleave" });
    expect(labels(s)).toBe("a0 a1 a4 a2 a3");
  });

  it("reverse reverses the whole board with fewer than 2 selected", () => {
    let s = run({ type: "add-source", source: source("a", 3) });
    s = boardReducer(selectAt(s, 0), { type: "reverse" });
    expect(labels(s)).toBe("a2 a1 a0");
  });

  it("turn-landscape turns landscape pages only", () => {
    const s = run(
      {
        type: "add-source",
        source: source("a", [landscape, portrait, landscape]),
      },
      { type: "turn-landscape" },
    );
    expect(s.history.present.map((p) => p.rotation)).toEqual([1, 0, 1]);
  });

  it("is one undo step", () => {
    const s = run(
      { type: "add-source", source: source("a", 4) },
      { type: "reverse" },
      { type: "undo" },
    );
    expect(labels(s)).toBe("a0 a1 a2 a3");
  });
});

describe("undo and redo", () => {
  it("return the same state when there is nothing to undo or redo", () => {
    expect(boardReducer(EMPTY_BOARD_STATE, { type: "undo" })).toBe(
      EMPTY_BOARD_STATE,
    );
    expect(boardReducer(EMPTY_BOARD_STATE, { type: "redo" })).toBe(
      EMPTY_BOARD_STATE,
    );
  });

  it("prune selected pages that the undo removed", () => {
    let s = run({ type: "add-source", source: source("a", 2) });
    s = boardReducer(selectAt(s, 0), { type: "duplicate" }); // copy selected
    s = boardReducer(s, { type: "undo" });
    expect(s.selection.keys.size).toBe(0);
  });
});

describe("arrangeScope", () => {
  const pages = run({ type: "add-source", source: source("a", 3) }).history
    .present;

  it("uses the selection when it is big enough", () => {
    const scope = arrangeScope(
      pages,
      selectKeys([pages[0].key, pages[2].key]),
      2,
    );
    expect(scope.selectionOnly).toBe(true);
    expect([...scope.keys]).toEqual([pages[0].key, pages[2].key]);
  });

  it("falls back to every page otherwise", () => {
    const scope = arrangeScope(pages, selectKeys([pages[0].key]), 2);
    expect(scope.selectionOnly).toBe(false);
    expect(scope.keys.size).toBe(3);
  });

  it("documents the minimum per action", () => {
    expect(ARRANGE_MINIMUM).toEqual({
      interleave: 2,
      reverse: 2,
      "turn-landscape": 1,
    });
  });
});

describe("blankInsertion", () => {
  const pages = run({ type: "add-source", source: source("a", 3) }).history
    .present;

  it("goes after the last selected page", () => {
    const at = blankInsertion(pages, selectKeys([pages[2].key, pages[0].key]));
    expect(at.gap).toBe(3);
    expect(at.neighbour).toBe(pages[2]);
  });

  it("goes to the end with no selection", () => {
    const at = blankInsertion(pages, EMPTY_SELECTION);
    expect(at.gap).toBe(3);
    expect(at.neighbour).toBe(pages[2]);
  });

  it("has no neighbour on an empty board", () => {
    expect(blankInsertion([], EMPTY_SELECTION)).toEqual({
      gap: 0,
      neighbour: undefined,
    });
  });
});

describe("selectedKeys", () => {
  it("lists the selection in board order", () => {
    let s = run({ type: "add-source", source: source("a", 3) });
    s = selectAt(s, 2, 0);
    expect(selectedKeys(s)).toEqual([keyAt(s, 0), keyAt(s, 2)]);
  });
});
