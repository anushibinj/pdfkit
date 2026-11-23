import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BoardToolbar, scopedLabel, type ToolbarState } from "./board-toolbar";
import { ZOOM_LEVELS } from "./core/zoom";

const base: ToolbarState = {
  pageCount: 5,
  selectedCount: 2,
  canUndo: true,
  canRedo: false,
  arrangeOnSelection: {
    interleave: true,
    reverse: true,
    "turn-landscape": true,
  },
  zoom: 1,
  saving: false,
};

/** Render the toolbar; override state. */
function show(state: Partial<ToolbarState> = {}) {
  const handlers = {
    onAction: vi.fn(),
    onAddFiles: vi.fn(),
    onZoom: vi.fn(),
    onDownload: vi.fn(),
    onStartOver: vi.fn(),
  };
  render(<BoardToolbar {...base} {...state} {...handlers} />);
  return handlers;
}
const button = (name: string) => screen.getByRole("button", { name });

describe("scopedLabel", () => {
  it("says whether an action applies to the selection or everything", () => {
    expect(scopedLabel("Reverse", true)).toBe("Reverse selected");
    expect(scopedLabel("Reverse", false)).toBe("Reverse all");
  });
});

describe("BoardToolbar", () => {
  it("sends the board action of each button", async () => {
    const user = userEvent.setup();
    const { onAction } = show({ canRedo: true });
    const expected: [string, unknown][] = [
      ["Undo", { type: "undo" }],
      ["Redo", { type: "redo" }],
      ["Rotate left", { type: "rotate", delta: -1 }],
      ["Rotate right", { type: "rotate", delta: 1 }],
      ["Move earlier", { type: "move-by", delta: -1 }],
      ["Move later", { type: "move-by", delta: 1 }],
      ["Duplicate", { type: "duplicate" }],
      ["Delete", { type: "delete" }],
      ["Insert blank page", { type: "insert-blank" }],
      ["Interleave selected", { type: "interleave" }],
      ["Reverse selected", { type: "reverse" }],
      ["Make portrait selected", { type: "turn-landscape" }],
    ];
    for (const [name] of expected) await user.click(button(name));
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(
      expected.map(([, action]) => action),
    );
  }, 15_000);

  it("labels arrange buttons for the whole board when the selection is too small", () => {
    show({
      arrangeOnSelection: {
        interleave: false,
        reverse: false,
        "turn-landscape": false,
      },
    });
    expect(button("Interleave all")).toBeEnabled();
    expect(button("Reverse all")).toBeEnabled();
    expect(button("Make portrait all")).toBeEnabled();
  });

  it("disables selection actions with nothing selected, and Delete with everything", () => {
    show({ selectedCount: 0 });
    for (const name of ["Rotate left", "Move later", "Duplicate", "Delete"])
      expect(button(name)).toBeDisabled();
    expect(button("Insert blank page")).toBeEnabled();
  });

  it("refuses to delete every page", () => {
    show({ selectedCount: 5 });
    expect(button("Delete")).toBeDisabled();
    expect(button("Rotate left")).toBeEnabled();
  });

  it("disables everything while saving and says so", () => {
    show({ saving: true });
    expect(button("Saving…")).toBeDisabled();
    expect(button("Undo")).toBeDisabled();
    expect(button("Add PDFs")).toBeDisabled();
    expect(button("Start over")).toBeDisabled();
  });

  it("disables download on an empty board and zoom at its ends", () => {
    show({ pageCount: 0, zoom: 0 });
    expect(button("Download PDF")).toBeDisabled();
    expect(button("Smaller thumbnails")).toBeDisabled();
    expect(button("Larger thumbnails")).toBeEnabled();
  });

  it("zooms, downloads, starts over and adds files", async () => {
    const user = userEvent.setup();
    const h = show({ zoom: ZOOM_LEVELS.length - 1 });
    expect(button("Larger thumbnails")).toBeDisabled();
    await user.click(button("Smaller thumbnails"));
    await user.click(button("Download PDF"));
    await user.click(button("Start over"));
    expect(h.onZoom).toHaveBeenCalledWith(-1);
    expect(h.onDownload).toHaveBeenCalled();
    expect(h.onStartOver).toHaveBeenCalled();
    const input = screen.getByTestId("add-files-input") as HTMLInputElement;
    const file = new File(["%PDF"], "more.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(h.onAddFiles).toHaveBeenCalledWith([file]);
  });
});
