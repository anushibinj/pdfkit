/**
 * Pins that the board re-renders only the thumbnails that changed. Every
 * thumbnail renders exactly one `PageCanvas`, so counting the (mocked)
 * canvas renders counts thumbnail renders.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canvas = vi.hoisted(() => vi.fn(() => null));
vi.mock("@/tools/edit/page-canvas", () => ({ PageCanvas: canvas }));

import type { PageInfo } from "@/tools/edit/core/model";
import { EMPTY_BOARD_STATE, boardReducer } from "./core/board-state";
import { PageBoard } from "./page-board";

const info: PageInfo = {
  box: { left: 0, bottom: 0, right: 100, top: 200 },
  rotation: 0,
};
const PAGES = 40;
const initial = boardReducer(EMPTY_BOARD_STATE, {
  type: "add-source",
  source: {
    id: "s1",
    name: "doc.pdf",
    colorIndex: 0,
    passwordProtected: false,
    pages: Array(PAGES).fill(info),
  },
});
const renderPage = () => new Promise<never>(() => {});

/** The board over the real reducer, plus a toolbar-like rotate button. */
function Harness() {
  const [state, dispatch] = useReducer(boardReducer, initial);
  return (
    <>
      <button onClick={() => dispatch({ type: "rotate", delta: 1 })}>
        rotate
      </button>
      <PageBoard
        state={state}
        dispatch={dispatch}
        render={renderPage}
        zoom={1}
        disabled={false}
        onAnnounce={() => {}}
      />
    </>
  );
}

beforeEach(() => canvas.mockClear());

describe("PageBoard rendering", () => {
  it("renders every thumbnail once at first", () => {
    render(<Harness />);
    expect(canvas).toHaveBeenCalledTimes(PAGES);
  });

  it("re-renders only the thumbnail whose selection changed", () => {
    render(<Harness />);
    canvas.mockClear();
    fireEvent.click(screen.getAllByRole("option")[7]);
    expect(canvas).toHaveBeenCalledTimes(1);
  });

  it("re-renders only the rotated thumbnail", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("option")[3]);
    canvas.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "rotate" }));
    expect(canvas).toHaveBeenCalledTimes(1);
  });
});
