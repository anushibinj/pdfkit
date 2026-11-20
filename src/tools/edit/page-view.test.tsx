import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_STYLE } from "./core/gestures";
import type { TextRun } from "./core/text-runs";
import type { TextRunsResult } from "./messages";
import {
  PageControls,
  PageView,
  editsToRender,
  type PageViewProps,
} from "./page-view";
import { fakeMetrics } from "./test-utils/fake-metrics";

const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const line: TextRun = {
  id: "2",
  indices: [2],
  text: "Hello",
  box: { left: 50, bottom: 340, right: 100, top: 350 },
  baseline: [1, 0, 0, 1, 50, 342],
  width: 50,
  fontSize: 10,
  style: { family: "sans", bold: false, italic: false },
  color: { r: 0, g: 0, b: 0 },
};

function pageView(overrides: Partial<PageViewProps> = {}) {
  const props: PageViewProps = {
    page: {
      key: "p3",
      sourceIndex: 3,
      rotation: 1,
      objects: [],
      textEdits: {},
    },
    info: { box: { left: 0, bottom: 0, right: 600, top: 400 }, rotation: 0 },
    pageNumber: 1,
    pageCount: 2,
    tool: "select",
    style: DEFAULT_TOOL_STYLE,
    selectedId: null,
    imageUrls: new Map(),
    metrics: fakeMetrics,
    pendingImage: null,
    newId: () => "x",
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onSelect: vi.fn(),
    renderPage: vi.fn(() => new Promise<never>(() => {})),
    loadTextRuns: vi.fn(async (): Promise<TextRunsResult> => ({
      status: "text-runs",
      runs: [line],
    })),
    onTextOutcomes: vi.fn(),
    onTextEdit: vi.fn(),
    editingObjectId: null,
    onEditObject: vi.fn(),
    onRotate: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const utils = render(<PageView {...props} />);
  return { ...utils, props };
}

function controls(pageNumber: number, pageCount: number, disabled = false) {
  const handlers = { onRotate: vi.fn(), onMove: vi.fn(), onDelete: vi.fn() };
  render(
    <PageControls
      pageNumber={pageNumber}
      pageCount={pageCount}
      disabled={disabled}
      {...handlers}
    />,
  );
  return handlers;
}

describe("PageControls", () => {
  it("shows the position and fires each operation", async () => {
    const user = userEvent.setup();
    const h = controls(2, 3);
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Rotate page 2 left" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rotate page 2 right" }),
    );
    await user.click(screen.getByRole("button", { name: "Move page 2 up" }));
    await user.click(screen.getByRole("button", { name: "Move page 2 down" }));
    await user.click(screen.getByRole("button", { name: "Delete page 2" }));
    expect(h.onRotate.mock.calls).toEqual([[-1], [1]]);
    expect(h.onMove.mock.calls).toEqual([[-1], [1]]);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  it("disables moves at the ends and deleting the only page", () => {
    controls(1, 1);
    expect(
      screen.getByRole("button", { name: "Move page 1 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move page 1 down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete page 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Rotate page 1 left" }),
    ).toBeEnabled();
  });

  it("disables everything while busy", () => {
    controls(2, 3, true);
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
  });
});

describe("editsToRender", () => {
  it("renders the stored edits, with the line being typed into hidden", () => {
    expect(editsToRender({ a: "x", b: "y" }, null)).toEqual([
      { runId: "a", text: "x" },
      { runId: "b", text: "y" },
    ]);
    expect(editsToRender({ a: "x", b: "y" }, "b")).toEqual([
      { runId: "a", text: "x" },
      { runId: "b", text: "" },
    ]);
    expect(editsToRender({}, "c")).toEqual([{ runId: "c", text: "" }]);
  });
});

describe("PageView", () => {
  it("renders the page (jsdom counts it as near) under an editing overlay", () => {
    const { props } = pageView();
    expect(
      screen.getByRole("region", { name: "Page 1 of 2" }),
    ).toBeInTheDocument();
    // source page 3, user turns 1, minimum render width (width unknown in jsdom)
    expect(props.renderPage).toHaveBeenCalledWith(3, 1, 512, {
      signal: expect.any(AbortSignal),
      textEdits: [],
    });
    expect(
      screen.getByLabelText("Page 1 editing area").getAttribute("viewBox"),
    ).toBe("0 0 400 600");
    // lines are only fetched for the Edit text tool
    expect(props.loadTextRuns).not.toHaveBeenCalled();
  });

  it("edits a line in place: hides it from the render while typing", async () => {
    const { props } = pageView({
      tool: "edit-text",
      page: {
        key: "p3",
        sourceIndex: 3,
        rotation: 0,
        objects: [],
        textEdits: { "9": "Other" },
      },
    });
    expect(props.loadTextRuns).toHaveBeenCalledWith(3);
    const target = await screen.findByRole("button", {
      name: "Edit text: Hello",
    });
    fireEvent.pointerDown(target, { button: 0 });
    const field = await screen.findByRole("textbox", {
      name: "Edit text: Hello",
    });
    expect(props.renderPage).toHaveBeenLastCalledWith(3, 0, 512, {
      signal: expect.any(AbortSignal),
      textEdits: [
        { runId: "9", text: "Other" },
        { runId: "2", text: "" },
      ],
    });
    fireEvent.change(field, { target: { value: "Howdy" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(props.onTextEdit).toHaveBeenCalledWith("2", "Howdy", "Hello");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("reports a page whose text cannot be read", async () => {
    pageView({
      tool: "edit-text",
      loadTextRuns: vi.fn(async (): Promise<TextRunsResult> => ({
        status: "error",
        reason: "failed",
        message: "broken",
      })),
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not read the text of page 1: broken",
      ),
    );
  });

  it("closes an open field when the tool changes", async () => {
    const { rerender, props } = pageView({ tool: "edit-text" });
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Edit text: Hello" }),
      { button: 0 },
    );
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
    rerender(<PageView {...props} tool="select" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    rerender(<PageView {...props} tool="edit-text" />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
