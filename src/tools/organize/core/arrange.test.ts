import { describe, expect, it } from "vitest";
import {
  TURN_DEGREES,
  duplicateKeys,
  insertAt,
  interleaveOrder,
  moveKeysBy,
  moveKeysTo,
  permuteSlots,
  removeKeys,
  reverseOrder,
  rotateKeys,
  sameOrder,
  turnLandscapeUpright,
} from "./arrange";
import type { BoardPage } from "./board";

/** Board pages "A".."E" from file "f", page i = letter index. */
function board(keys = "ABCDE"): BoardPage[] {
  return [...keys].map((key, pageIndex) => ({
    kind: "source",
    key,
    sourceId: "f",
    pageIndex,
    rotation: 0,
  }));
}
const keysOf = (pages: readonly { key: string }[]) =>
  pages.map((p) => p.key).join("");
const set = (keys: string) => new Set([...keys]);

describe("sameOrder", () => {
  it("compares element identity and order", () => {
    const [a, b] = [{}, {}];
    expect(sameOrder([a, b], [a, b])).toBe(true);
    expect(sameOrder([a, b], [b, a])).toBe(false);
    expect(sameOrder([a], [a, b])).toBe(false);
    expect(sameOrder([{}], [{}])).toBe(false);
  });
});

describe("moveKeysTo", () => {
  it("moves a scattered selection as one block (worked example)", () => {
    expect(keysOf(moveKeysTo(board(), set("BD"), 4))).toBe("ACBDE");
  });

  it("moves to the very start and the very end", () => {
    expect(keysOf(moveKeysTo(board(), set("D"), 0))).toBe("DABCE");
    expect(keysOf(moveKeysTo(board(), set("B"), 5))).toBe("ACDEB");
  });

  it("clamps gaps outside the board", () => {
    expect(keysOf(moveKeysTo(board(), set("A"), 99))).toBe("BCDEA");
    expect(keysOf(moveKeysTo(board(), set("E"), -3))).toBe("EABCD");
    expect(keysOf(moveKeysTo(board(), set("E"), Number.NaN))).toBe("EABCD");
  });

  it("returns the same array when nothing moves", () => {
    const pages = board();
    expect(moveKeysTo(pages, set("C"), 2)).toBe(pages);
    expect(moveKeysTo(pages, set("C"), 3)).toBe(pages);
    expect(moveKeysTo(pages, set("BC"), 1)).toBe(pages);
    expect(moveKeysTo(pages, set("Z"), 0)).toBe(pages);
    expect(moveKeysTo(pages, new Set(), 0)).toBe(pages);
  });
});

describe("moveKeysBy", () => {
  it("moves a contiguous block by exactly delta places", () => {
    expect(keysOf(moveKeysBy(board(), set("BC"), 1))).toBe("ADBCE");
    expect(keysOf(moveKeysBy(board(), set("BC"), -1))).toBe("BCADE");
    expect(keysOf(moveKeysBy(board(), set("A"), 2))).toBe("BCADE");
  });

  it("gathers a scattered selection at its first page, then moves", () => {
    expect(keysOf(moveKeysBy(board(), set("BD"), 0))).toBe("ABDCE");
    expect(keysOf(moveKeysBy(board(), set("BD"), 1))).toBe("ACBDE");
  });

  it("clamps at both ends", () => {
    expect(keysOf(moveKeysBy(board(), set("D"), -99))).toBe("DABCE");
    expect(keysOf(moveKeysBy(board(), set("B"), 99))).toBe("ACDEB");
  });

  it("returns the same array when the block cannot move", () => {
    const pages = board();
    expect(moveKeysBy(pages, set("A"), -1)).toBe(pages);
    expect(moveKeysBy(pages, set("DE"), 1)).toBe(pages);
    expect(moveKeysBy(pages, new Set(), 1)).toBe(pages);
  });
});

describe("rotateKeys", () => {
  it("adds quarter turns to the given pages only, wrapping around", () => {
    const turned = rotateKeys(board("AB"), set("A"), -1);
    expect(turned.map((p) => p.rotation)).toEqual([3, 0]);
    expect(rotateKeys(turned, set("A"), 1)[0].rotation).toBe(0);
  });

  it("returns the same array for no pages or a full turn", () => {
    const pages = board();
    expect(rotateKeys(pages, new Set(), 1)).toBe(pages);
    expect(rotateKeys(pages, set("A"), 4)).toBe(pages);
  });
});

describe("removeKeys", () => {
  it("removes the given pages", () => {
    expect(keysOf(removeKeys(board(), set("BD")))).toBe("ACE");
  });

  it("refuses to remove every page or none", () => {
    const pages = board("AB");
    expect(removeKeys(pages, set("AB"))).toBe(pages);
    expect(removeKeys(pages, set("Z"))).toBe(pages);
  });
});

describe("duplicateKeys", () => {
  it("puts each copy right after its original, with a new key", () => {
    let n = 0;
    const { pages, created } = duplicateKeys(
      board("ABC"),
      set("AC"),
      () => `x${++n}`,
    );
    expect(keysOf(pages)).toBe("Ax1BCx2");
    expect(created).toEqual(["x1", "x2"]);
    expect(pages[1]).toMatchObject({ kind: "source", pageIndex: 0 });
  });

  it("returns the same array when nothing matches", () => {
    const original = board();
    const { pages, created } = duplicateKeys(original, set("Z"), () => "x");
    expect(pages).toBe(original);
    expect(created).toEqual([]);
  });
});

describe("insertAt", () => {
  it("inserts at a gap, clamped to the list", () => {
    expect(insertAt(["a", "b"], 1, "x")).toEqual(["a", "x", "b"]);
    expect(insertAt(["a"], 9, "x")).toEqual(["a", "x"]);
    expect(insertAt(["a"], -1, "x")).toEqual(["x", "a"]);
  });
});

describe("permuteSlots", () => {
  it("refills only the slots the scope occupies", () => {
    const next = permuteSlots(board(), set("ACE"), reverseOrder);
    expect(keysOf(next)).toBe("EBCDA");
  });

  it("returns the same array when the permutation keeps the order", () => {
    const pages = board();
    expect(permuteSlots(pages, set("AB"), (s) => [...s])).toBe(pages);
  });

  it("throws when the permutation loses or invents pages", () => {
    const pages = board();
    expect(() => permuteSlots(pages, set("AB"), (s) => s.slice(1))).toThrow();
    expect(() => permuteSlots(pages, set("AB"), (s) => [s[0], s[0]])).toThrow();
    expect(() => permuteSlots(pages, set("AB"), () => board("XY"))).toThrow();
  });
});

describe("interleaveOrder", () => {
  it("restores a 10-page duplex scan: fronts, then reversed backs", () => {
    const scanned = [1, 3, 5, 7, 9, 10, 8, 6, 4, 2];
    expect(interleaveOrder(scanned)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("puts the extra front last for an odd count", () => {
    expect(interleaveOrder([1, 3, 5, 4, 2])).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles tiny inputs", () => {
    expect(interleaveOrder([])).toEqual([]);
    expect(interleaveOrder([1])).toEqual([1]);
    expect(interleaveOrder([1, 2])).toEqual([1, 2]);
  });
});

describe("reverseOrder", () => {
  it("reverses into a new array", () => {
    const items = [1, 2, 3];
    expect(reverseOrder(items)).toEqual([3, 2, 1]);
    expect(items).toEqual([1, 2, 3]);
  });
});

describe("turnLandscapeUpright", () => {
  const sizes: Record<string, { width: number; height: number } | null> = {
    A: { width: 800, height: 600 }, // landscape
    B: { width: 600, height: 800 }, // portrait
    C: { width: 500, height: 500 }, // square
    D: null, // unknown
  };
  const sizeOf = (p: BoardPage) => sizes[p.key];

  it("turns only landscape pages in scope, clockwise", () => {
    const pages = board("ABCD");
    const next = turnLandscapeUpright(pages, set("ABCD"), sizeOf);
    expect(next.map((p) => p.rotation)).toEqual([1, 0, 0, 0]);
  });

  it("returns the same array when nothing is landscape", () => {
    const pages = board("ABCD");
    expect(turnLandscapeUpright(pages, set("BCD"), sizeOf)).toBe(pages);
  });
});

describe("TURN_DEGREES", () => {
  it("maps quarter turns to degrees", () => {
    expect(TURN_DEGREES).toEqual({ 0: 0, 1: 90, 2: 180, 3: 270 });
  });
});
