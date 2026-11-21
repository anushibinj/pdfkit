import { fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageInfo } from "@/tools/edit/core/model";
import {
  EMPTY_BOARD_STATE,
  boardReducer,
  type BoardState,
} from "./core/board-state";
import {
  PageBoard,
  cardFor,
  measureColumns,
  selectModeFor,
} from "./page-board";

const info: PageInfo = {
  box: { left: 0, bottom: 0, right: 100, top: 200 },
  rotation: 0,
};

/** A board with `n` pages of one file. */
function boardOf(n: number): BoardState {
  return boardReducer(EMPTY_BOARD_STATE, {
    type: "add-source",
    source: {
      id: "s1",
      name: "doc.pdf",
      colorIndex: 0,
      passwordProtected: false,
      pages: Array(n).fill(info),
    },
  });
}

/** Mounts the board over the real reducer. */
function Harness({
  initial,
  onAnnounce,
}: {
  initial: BoardState;
  onAnnounce(message: string): void;
}) {
  const [state, dispatch] = useReducer(boardReducer, initial);
  return (
    <>
      <button onClick={() => dispatch({ type: "rotate", delta: 1 })}>
        outside rotate
      </button>
      <button onClick={() => dispatch({ type: "delete" })}>
        outside delete
      </button>
      <PageBoard
        state={state}
        dispatch={dispatch}
        render={() => new Promise(() => {})}
        zoom={1}
        disabled={false}
        onAnnounce={onAnnounce}
      />
    </>
  );
}

function show(n = 4) {
  const onAnnounce = vi.fn();
  render(<Harness initial={boardOf(n)} onAnnounce={onAnnounce} />);
  return { onAnnounce };
}
/** Page labels in board order ("p.1", "p.2" ... the file page numbers). */
const order = () =>
  screen
    .getAllByRole("option")
    .map((o) => o.getAttribute("aria-label")!.match(/page (\d+)$/)![1])
    .join(",");
const selected = () =>
  screen
    .getAllByRole("option")
    .map((o, i) => (o.getAttribute("aria-selected") === "true" ? i + 1 : 0))
    .filter(Boolean);
const option = (i: number) => screen.getAllByRole("option")[i];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("selectModeFor", () => {
  const mods = { ctrlKey: false, metaKey: false, shiftKey: false };
  it("maps modifiers and the tick to selection modes", () => {
    expect(selectModeFor(mods, false)).toBe("only");
    expect(selectModeFor(mods, true)).toBe("toggle");
    expect(selectModeFor({ ...mods, ctrlKey: true }, false)).toBe("toggle");
    expect(selectModeFor({ ...mods, metaKey: true }, false)).toBe("toggle");
    expect(selectModeFor({ ...mods, shiftKey: true }, false)).toBe("range");
    expect(
      selectModeFor({ ...mods, shiftKey: true, ctrlKey: true }, true),
    ).toBe("add-range");
  });
});

describe("cardFor and measureColumns", () => {
  it("find cards by key and count the first row", () => {
    const container = document.createElement("div");
    const tops = [0, 0, 0, 90, 90];
    for (const [i, top] of tops.entries()) {
      const card = document.createElement("div");
      card.dataset.key = `k${i}`;
      Object.defineProperty(card, "offsetTop", { value: top });
      container.append(card);
    }
    expect(cardFor(container, "k3")).toBe(container.children[3]);
    expect(cardFor(container, "nope")).toBeNull();
    expect(cardFor(null, "k1")).toBeNull();
    expect(measureColumns(container)).toBe(3);
    expect(measureColumns(null)).toBe(1);
  });
});

describe("PageBoard clicks", () => {
  it("selects with a click, Ctrl/Cmd toggles, Shift selects a range", () => {
    show(5);
    fireEvent.click(option(1));
    expect(selected()).toEqual([2]);
    fireEvent.click(option(3), { ctrlKey: true });
    expect(selected()).toEqual([2, 4]);
    fireEvent.click(option(4), { shiftKey: true });
    expect(selected()).toEqual([4, 5]);
    fireEvent.click(option(0), { metaKey: true });
    expect(selected()).toEqual([1, 4, 5]);
  });

  it("the tick toggles without modifier keys (touch screens)", () => {
    show(3);
    fireEvent.click(option(0).querySelector("[data-toggle]")!);
    fireEvent.click(option(2).querySelector("[data-toggle]")!);
    expect(selected()).toEqual([1, 3]);
  });

  it("a click between the cards clears the selection", () => {
    show(3);
    fireEvent.click(option(0));
    fireEvent.click(screen.getByRole("listbox"));
    expect(selected()).toEqual([]);
  });
});

describe("PageBoard keyboard", () => {
  it("has one tab stop and moves focus with the arrow keys", () => {
    show(4);
    expect(
      screen.getAllByRole("option").map((o) => o.getAttribute("tabindex")),
    ).toEqual(["0", "-1", "-1", "-1"]);
    option(0).focus();
    fireEvent.keyDown(option(0), { key: "ArrowRight" });
    expect(document.activeElement).toBe(option(1));
    expect(option(1)).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(option(1), { key: "End" });
    expect(document.activeElement).toBe(option(3));
    fireEvent.keyDown(option(3), { key: "Home" });
    expect(document.activeElement).toBe(option(0));
  });

  it("jumps rows with up and down, using the measured columns", () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return Number(this.dataset.boardIndex) >= 2 ? 100 : 0;
      },
    );
    show(4); // two rows of two
    option(0).focus();
    fireEvent.keyDown(option(0), { key: "ArrowDown" });
    expect(document.activeElement).toBe(option(2));
    fireEvent.keyDown(option(2), { key: "ArrowUp" });
    expect(document.activeElement).toBe(option(0));
  });

  it("Space toggles, Shift+arrows extend, Ctrl+A selects all, Escape clears", () => {
    show(4);
    option(0).focus();
    fireEvent.keyDown(option(0), { key: " " });
    expect(selected()).toEqual([1]);
    fireEvent.keyDown(option(0), { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(option(1), { key: "ArrowRight", shiftKey: true });
    expect(selected()).toEqual([1, 2, 3]);
    fireEvent.keyDown(option(2), { key: "a", ctrlKey: true });
    expect(selected()).toEqual([1, 2, 3, 4]);
    fireEvent.keyDown(option(2), { key: "Escape" });
    expect(selected()).toEqual([]);
  });

  it("Shift+arrow with no anchor starts the range at the focused page", () => {
    show(4);
    option(1).focus();
    fireEvent.keyDown(option(1), { key: "ArrowRight", shiftKey: true });
    expect(selected()).toEqual([2, 3]);
  });

  it("Ctrl+arrows move the focused page, keep focus on it and announce it", () => {
    const { onAnnounce } = show(4);
    option(0).focus();
    fireEvent.keyDown(option(0), { key: "ArrowRight", ctrlKey: true });
    expect(order()).toBe("2,1,3,4");
    expect(document.activeElement).toBe(option(1));
    expect(option(1)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(option(1), { key: "End", metaKey: true });
    expect(order()).toBe("2,3,4,1");
    expect(document.activeElement).toBe(option(3));
    expect(onAnnounce).toHaveBeenLastCalledWith("Moved 1 page.");
  });

  it("Ctrl+arrows move the whole selection when the focused page is in it", () => {
    show(4);
    fireEvent.click(option(0));
    fireEvent.click(option(1), { shiftKey: true });
    option(1).focus();
    fireEvent.keyDown(option(1), { key: "ArrowRight", ctrlKey: true });
    expect(order()).toBe("3,1,2,4");
  });

  it("a move at the end of the board changes and announces nothing", () => {
    const { onAnnounce } = show(3);
    option(2).focus();
    fireEvent.keyDown(option(2), { key: "ArrowRight", ctrlKey: true });
    expect(order()).toBe("1,2,3");
    expect(onAnnounce).not.toHaveBeenCalled();
  });

  it("leaves undo, redo and delete to the window shortcuts", () => {
    show(2);
    fireEvent.click(option(0));
    option(0).focus();
    fireEvent.keyDown(option(0), { key: "Delete" });
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("does not pull focus back after a move that changed nothing", () => {
    show(3);
    option(0).focus();
    // Already first: nothing moves, but the page gets selected.
    fireEvent.keyDown(option(0), { key: "ArrowLeft", ctrlKey: true });
    const outside = screen.getByRole("button", { name: "outside rotate" });
    outside.focus();
    fireEvent.click(outside);
    expect(option(0)).toHaveAccessibleName(/turned 90°/);
    expect(document.activeElement).toBe(outside);
  });
});

describe("PageBoard focus after deleting", () => {
  it("moves focus to the page that took the deleted page's place", () => {
    show(4);
    fireEvent.click(option(1));
    option(1).focus();
    // Delete arrives from the window shortcut; here from a button that
    // does not take focus away first (like a key press).
    fireEvent.click(screen.getByRole("button", { name: "outside delete" }));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(document.activeElement).toBe(option(1));
    expect(option(1)).toHaveAttribute("tabindex", "0");
  });

  it("moves focus to the new last page when the last page was deleted", () => {
    show(3);
    fireEvent.click(option(2));
    option(2).focus();
    fireEvent.click(screen.getByRole("button", { name: "outside delete" }));
    expect(document.activeElement).toBe(option(1));
  });

  it("leaves focus alone when it was outside the board", () => {
    show(3);
    fireEvent.click(option(2));
    const outside = screen.getByRole("button", { name: "outside delete" });
    outside.focus();
    fireEvent.click(outside);
    expect(document.activeElement).toBe(outside);
  });
});
