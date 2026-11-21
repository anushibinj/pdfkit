import { describe, expect, it } from "vitest";
import type { PageInfo } from "@/tools/edit/core/model";
import { announcementFor, pageCountLabel } from "./announcements";
import {
  EMPTY_BOARD_STATE,
  boardReducer,
  type BoardAction,
  type BoardState,
} from "./core/board-state";

const portrait: PageInfo = {
  box: { left: 0, bottom: 0, right: 100, top: 200 },
  rotation: 0,
};

/** A board with `n` portrait pages of one file. */
function board(n: number): BoardState {
  return boardReducer(EMPTY_BOARD_STATE, {
    type: "add-source",
    source: {
      id: "a",
      name: "a.pdf",
      colorIndex: 0,
      passwordProtected: false,
      pages: Array(n).fill(portrait),
    },
  });
}
/** Select the first `n` pages. */
function selectFirst(state: BoardState, n: number): BoardState {
  return state.history.present
    .slice(0, n)
    .reduce(
      (s, p) => boardReducer(s, { type: "select", key: p.key, mode: "toggle" }),
      state,
    );
}
/** The announcement for running `action` on `state`. */
const say = (state: BoardState, action: BoardAction) =>
  announcementFor(action, state, boardReducer(state, action));

describe("pageCountLabel", () => {
  it("uses the singular for one page", () => {
    expect(pageCountLabel(1)).toBe("1 page");
    expect(pageCountLabel(0)).toBe("0 pages");
    expect(pageCountLabel(3)).toBe("3 pages");
  });
});

describe("announcementFor", () => {
  it("reports what changed", () => {
    const s = selectFirst(board(4), 2);
    expect(say(s, { type: "rotate", delta: 1 })).toBe("Turned 2 pages right.");
    expect(say(s, { type: "rotate", delta: -1 })).toBe("Turned 2 pages left.");
    expect(say(s, { type: "move-by", delta: 1 })).toBe("Moved 2 pages.");
    expect(say(s, { type: "delete" })).toBe("Deleted 2 pages.");
    expect(say(s, { type: "duplicate" })).toBe("Duplicated 2 pages.");
    expect(say(s, { type: "insert-blank" })).toBe("Inserted a blank page.");
  });

  it("says why nothing happened", () => {
    const none = board(3);
    expect(say(none, { type: "rotate", delta: 1 })).toBe(
      "Select pages to turn first.",
    );
    expect(say(none, { type: "delete" })).toBe("Select pages to delete first.");
    expect(say(none, { type: "duplicate" })).toBe(
      "Select pages to duplicate first.",
    );
    expect(say(selectFirst(none, 3), { type: "delete" })).toBe(
      "The organized file needs at least one page.",
    );
    expect(say(none, { type: "move-by", delta: 1 })).toBeNull();
  });

  it("names the scope of arrange actions", () => {
    const all = board(4);
    expect(say(all, { type: "reverse" })).toBe("Reversed all pages.");
    expect(say(all, { type: "interleave" })).toBe("Interleaved all pages.");
    expect(say(selectFirst(all, 2), { type: "reverse" })).toBe(
      "Reversed the selected pages.",
    );
    expect(say(all, { type: "turn-landscape" })).toBe(
      "No landscape pages among all pages.",
    );
    expect(say(board(1), { type: "reverse" })).toBe(
      "The order of all pages did not change.",
    );
  });

  it("announces landscape pages turned upright", () => {
    const s = boardReducer(EMPTY_BOARD_STATE, {
      type: "add-source",
      source: {
        id: "l",
        name: "l.pdf",
        colorIndex: 0,
        passwordProtected: false,
        pages: [{ ...portrait, rotation: 1 }],
      },
    });
    expect(say(s, { type: "turn-landscape" })).toBe(
      "Turned the landscape pages among all pages upright.",
    );
  });

  it("announces undo and redo only when they did something", () => {
    const s = boardReducer(selectFirst(board(2), 1), {
      type: "rotate",
      delta: 1,
    });
    expect(say(s, { type: "undo" })).toBe("Undone.");
    expect(say(boardReducer(s, { type: "undo" }), { type: "redo" })).toBe(
      "Redone.",
    );
    expect(say(EMPTY_BOARD_STATE, { type: "undo" })).toBeNull();
    expect(say(EMPTY_BOARD_STATE, { type: "redo" })).toBeNull();
  });

  it("stays quiet for selection changes", () => {
    expect(say(board(2), { type: "select-all" })).toBeNull();
  });
});
