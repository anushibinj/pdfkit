import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, commit, createHistory, redo, undo } from "./history";

describe("createHistory", () => {
  it("starts with nothing to undo or redo", () => {
    expect(createHistory("a")).toEqual({ past: [], present: "a", future: [] });
  });
});

describe("commit", () => {
  it("pushes the old value and clears the redo branch", () => {
    const h = redo(undo(commit(createHistory(1), 2)));
    const h2 = commit(undo(h), 3);
    expect(h2).toMatchObject({ past: [1], present: 3, future: [] });
  });

  it("ignores a commit of the present value", () => {
    const h = createHistory({ n: 1 });
    expect(commit(h, h.present)).toBe(h);
  });

  it("coalesces consecutive commits with the same key", () => {
    let h = createHistory("");
    h = commit(h, "H", "text:1");
    h = commit(h, "He", "text:1");
    h = commit(h, "Hel", "text:1");
    expect(h.past).toEqual([""]);
    expect(h.present).toBe("Hel");
    expect(undo(h).present).toBe("");
  });

  it("starts a new step when the key changes or is absent", () => {
    let h = createHistory("");
    h = commit(h, "a", "text:1");
    h = commit(h, "ab", "text:2");
    h = commit(h, "abc");
    h = commit(h, "abcd");
    expect(h.past).toEqual(["", "a", "ab", "abc"]);
  });

  it("does not coalesce across an undo", () => {
    let h = commit(createHistory(""), "a", "k");
    h = undo(h);
    h = commit(h, "b", "k");
    expect(h.past).toEqual([""]);
    expect(h.coalesceKey).toBe("k");
  });

  it("caps the number of undo steps", () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = commit(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(10);
  });
});

describe("undo", () => {
  it("restores the previous value and makes it redoable", () => {
    const h = undo(commit(commit(createHistory("a"), "b"), "c"));
    expect(h).toEqual({ past: ["a"], present: "b", future: ["c"] });
  });

  it("returns the same object when there is nothing to undo", () => {
    const h = createHistory("a");
    expect(undo(h)).toBe(h);
  });
});

describe("redo", () => {
  it("re-applies undone values in order", () => {
    let h = commit(commit(createHistory("a"), "b"), "c");
    h = undo(undo(h));
    expect(h.present).toBe("a");
    h = redo(h);
    expect(h.present).toBe("b");
    h = redo(h);
    expect(h).toEqual({ past: ["a", "b"], present: "c", future: [] });
  });

  it("returns the same object when there is nothing to redo", () => {
    const h = createHistory("a");
    expect(redo(h)).toBe(h);
  });
});
