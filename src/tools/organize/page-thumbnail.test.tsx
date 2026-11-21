import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardPage, BoardSource } from "./core/board";
import type { RenderResult } from "./messages";
import {
  PageThumbnail,
  thumbnailLabel,
  toCanvasResult,
} from "./page-thumbnail";

const source: BoardSource = {
  id: "s1",
  name: "report.pdf",
  colorIndex: 2,
  passwordProtected: false,
  pages: [],
};
const page: BoardPage = {
  kind: "source",
  key: "k1",
  sourceId: "s1",
  pageIndex: 1,
  rotation: 0,
};
const blank: BoardPage = {
  kind: "blank",
  key: "k2",
  width: 100,
  height: 200,
  rotation: 0,
};
const rendered: RenderResult = {
  status: "rendered",
  width: 2,
  height: 1,
  pixels: new ArrayBuffer(8),
};

beforeEach(() => {
  // jsdom has no canvas; say so quietly instead of logging an error
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

/** Render a thumbnail with defaults; override any prop. */
function show(props: Partial<Parameters<typeof PageThumbnail>[0]> = {}) {
  const handlers = {
    render: vi.fn(async () => rendered),
    onPointerDown: vi.fn(),
    onClick: vi.fn(),
    onFocus: vi.fn(),
  };
  render(
    <PageThumbnail
      page={page}
      index={2}
      source={source}
      fileNumber={3}
      size={{ width: 100, height: 200 }}
      selected={false}
      tabbable
      dragging={false}
      dropMark={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("toCanvasResult", () => {
  it("adds an empty text-outcome list to a rendered result", () => {
    expect(toCanvasResult(rendered)).toEqual({ ...rendered, textOutcomes: [] });
  });

  it("passes errors through", () => {
    const error = { status: "error", reason: "failed", message: "x" } as const;
    expect(toCanvasResult(error)).toBe(error);
  });
});

describe("thumbnailLabel", () => {
  it("names the position, file, page and turn", () => {
    expect(thumbnailLabel(page, 3, source)).toBe("Page 3: report.pdf, page 2");
    expect(thumbnailLabel({ ...page, rotation: 3 }, 3, source)).toBe(
      "Page 3: report.pdf, page 2, turned 270°",
    );
    expect(thumbnailLabel(blank, 1, undefined)).toBe("Page 1: blank page");
    expect(thumbnailLabel(page, 1, undefined)).toBe(
      "Page 1: unknown file, page 2",
    );
  });
});

describe("PageThumbnail", () => {
  it("is a labelled, selectable option in the tab order", () => {
    show({ selected: true });
    const option = screen.getByRole("option", {
      name: "Page 3: report.pdf, page 2",
    });
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(option).toHaveAttribute("tabindex", "0");
    expect(option).toHaveAttribute("data-board-index", "2");
    expect(option).toHaveTextContent("3"); // file number chip
  });

  it("is out of the tab order unless tabbable", () => {
    show({ tabbable: false });
    expect(screen.getByRole("option")).toHaveAttribute("tabindex", "-1");
  });

  it("renders its page through the source's renderer", async () => {
    const { render: renderPage } = show({ page: { ...page, rotation: 1 } });
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    const [sourceId, pageIndex, rotation, width, signal] = renderPage.mock
      .calls[0] as unknown as [string, number, number, number, AbortSignal];
    expect([sourceId, pageIndex, rotation]).toEqual(["s1", 1, 1]);
    expect(width).toBeGreaterThanOrEqual(128);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("shows a blank page without rendering anything", () => {
    const { render: renderPage } = show({ page: blank, source: undefined });
    expect(screen.getByRole("option")).toHaveTextContent("Blank");
    expect(document.querySelector("canvas")).toBeNull();
    expect(renderPage).not.toHaveBeenCalled();
  });

  it("shows the rotation, the drop indicator and the dragging state", () => {
    show({ page: { ...page, rotation: 2 }, dropMark: "after", dragging: true });
    expect(screen.getByRole("option")).toHaveTextContent("180°");
    expect(screen.getByTestId("drop-indicator")).toHaveClass("-right-2");
    expect(screen.getByRole("option")).toHaveClass("opacity-40");
  });

  it("forwards pointer, click and focus events with its key", () => {
    const handlers = show();
    const option = screen.getByRole("option");
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    option.focus();
    expect(handlers.onClick).toHaveBeenCalledWith(expect.anything(), "k1");
    expect(handlers.onFocus).toHaveBeenCalledWith("k1");
  });
});
