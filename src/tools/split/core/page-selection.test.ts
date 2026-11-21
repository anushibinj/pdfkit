import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  describePages,
  selectionReducer,
  type PageSelection,
  type SelectionAction,
} from "./page-selection";

/** Apply actions one after another from an empty selection. */
function run(...actions: SelectionAction[]): PageSelection {
  return actions.reduce(selectionReducer, EMPTY_SELECTION);
}

const click = (index: number, extend = false): SelectionAction => ({
  type: "toggle",
  index,
  extend,
});

describe("selectionReducer", () => {
  it("a click selects a page and a second click deselects it", () => {
    const once = run(click(2));
    expect([...once.pages]).toEqual([2]);
    expect(once.text).toBe("3");
    const twice = selectionReducer(once, click(2));
    expect(twice.pages.size).toBe(0);
    expect(twice.text).toBe("");
  });

  it("clicks rewrite the field in tidy page order", () => {
    const state = run(click(4), click(0), click(1), click(2));
    expect(state.text).toBe("1-3, 5");
  });

  it("Shift-click selects the stretch from the anchor, in either direction", () => {
    expect(run(click(1), click(4, true)).text).toBe("2-5");
    expect(run(click(4), click(1, true)).text).toBe("2-5");
  });

  it("Shift-click keeps the anchor for the next Shift-click", () => {
    const state = run(click(5), click(7, true), click(3, true));
    expect(state.text).toBe("4-8");
    expect(state.anchor).toBe(5);
  });

  it("Shift-click without an anchor flips just that page", () => {
    expect(run(click(3, true)).text).toBe("4");
  });

  it("Shift-click only adds pages", () => {
    // {1} with the anchor on 2 after the third click; the two Shift-clicks
    // add 1..2 (already partly selected) and 2..3, never removing anything.
    const state = run(click(1), click(2), click(2), click(1, true), click(3, true));
    expect(describePages(state.pages)).toBe("2-4");
  });

  it("typing a valid list selects those pages", () => {
    const state = run({ type: "type", text: "1-2, 9", pageCount: 10 });
    expect([...state.pages].sort()).toEqual([0, 1, 8]);
    expect(state.error).toBeNull();
    // the typed text is kept as typed, not rewritten
    expect(state.text).toBe("1-2, 9");
  });

  it("typing an invalid list keeps the last valid pages and explains", () => {
    const valid = run({ type: "type", text: "1-2", pageCount: 10 });
    const invalid = selectionReducer(valid, {
      type: "type",
      text: "1-2, 12",
      pageCount: 10,
    });
    expect(invalid.text).toBe("1-2, 12");
    expect(invalid.error).toMatch(/only 10 pages/);
    expect(invalid.pages).toBe(valid.pages);
  });

  it("a click after a typing mistake clears the error", () => {
    const state = run(
      { type: "type", text: "x", pageCount: 10 },
      click(0),
    );
    expect(state.error).toBeNull();
    expect(state.text).toBe("1");
  });

  it("clear forgets everything", () => {
    expect(run(click(1), { type: "clear" })).toBe(EMPTY_SELECTION);
  });

  it("does not modify the previous state", () => {
    const before = run(click(1));
    selectionReducer(before, click(2));
    expect([...before.pages]).toEqual([1]);
  });
});

describe("describePages", () => {
  it("sorts and groups the pages", () => {
    expect(describePages(new Set([9, 0, 2, 1]))).toBe("1-3, 10");
    expect(describePages(new Set())).toBe("");
  });
});
