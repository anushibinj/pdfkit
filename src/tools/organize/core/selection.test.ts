import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  keyRange,
  pruneSelection,
  selectKeys,
  selectPage,
  selectedInOrder,
  type BoardSelection,
} from "./selection";

const order = ["a", "b", "c", "d", "e"];
const keys = (s: BoardSelection) => [...s.keys].sort().join("");

describe("keyRange", () => {
  it("returns the inclusive range in board order, either direction", () => {
    expect(keyRange(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(keyRange(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(keyRange(order, "c", "c")).toEqual(["c"]);
  });

  it("degrades gracefully for keys not on the board", () => {
    expect(keyRange(order, "zz", "c")).toEqual(["c"]);
    expect(keyRange(order, "a", "zz")).toEqual([]);
  });
});

describe("selectPage", () => {
  it("'only' selects just the clicked page and anchors there", () => {
    const s = selectPage(selectKeys(["a", "b"]), order, "c", "only");
    expect(keys(s)).toBe("c");
    expect(s.anchor).toBe("c");
  });

  it("'only' on the already sole selection returns the same object", () => {
    const s = selectKeys(["c"], "c");
    expect(selectPage(s, order, "c", "only")).toBe(s);
  });

  it("'toggle' adds and removes, moving the anchor", () => {
    let s = selectPage(EMPTY_SELECTION, order, "b", "toggle");
    s = selectPage(s, order, "d", "toggle");
    expect(keys(s)).toBe("bd");
    s = selectPage(s, order, "b", "toggle");
    expect(keys(s)).toBe("d");
    expect(s.anchor).toBe("b");
  });

  it("'range' selects from the anchor and keeps the anchor", () => {
    let s = selectPage(EMPTY_SELECTION, order, "b", "only");
    s = selectPage(s, order, "d", "range");
    expect(keys(s)).toBe("bcd");
    s = selectPage(s, order, "a", "range");
    expect(keys(s)).toBe("ab");
    expect(s.anchor).toBe("b");
  });

  it("'range' without an anchor selects just the page", () => {
    const s = selectPage(EMPTY_SELECTION, order, "c", "range");
    expect(keys(s)).toBe("c");
    expect(s.anchor).toBe("c");
  });

  it("'add-range' adds the range to the selection", () => {
    let s = selectPage(EMPTY_SELECTION, order, "a", "only");
    s = selectPage(s, order, "d", "toggle");
    s = selectPage(s, order, "e", "add-range");
    expect(keys(s)).toBe("ade");
  });

  it("ignores keys that are not on the board", () => {
    const s = selectKeys(["a"]);
    expect(selectPage(s, order, "zz", "only")).toBe(s);
  });
});

describe("selectKeys", () => {
  it("uses the first key as anchor unless one is given", () => {
    expect(selectKeys(["c", "a"]).anchor).toBe("c");
    expect(selectKeys(["c", "a"], "a").anchor).toBe("a");
    expect(selectKeys([], null).anchor).toBeNull();
    expect(selectKeys([]).anchor).toBeNull();
  });
});

describe("pruneSelection", () => {
  it("drops keys and an anchor that left the board", () => {
    const s = pruneSelection(selectKeys(["a", "zz"], "zz"), order);
    expect(keys(s)).toBe("a");
    expect(s.anchor).toBeNull();
  });

  it("returns the same object when nothing is stale", () => {
    const s = selectKeys(["a", "b"], "a");
    expect(pruneSelection(s, order)).toBe(s);
  });
});

describe("selectedInOrder", () => {
  it("lists selected keys in board order, not click order", () => {
    expect(selectedInOrder(order, selectKeys(["d", "a", "c"]))).toEqual([
      "a",
      "c",
      "d",
    ]);
  });
});
