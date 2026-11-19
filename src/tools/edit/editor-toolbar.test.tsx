import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorToolbar, TOOLS } from "./editor-toolbar";

function setup(overrides: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  const props = {
    tool: "select" as const,
    onToolChange: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onPickImage: vi.fn(),
    onDownload: vi.fn(),
    onClose: vi.fn(),
    saving: false,
    ...overrides,
  };
  const utils = render(<EditorToolbar {...props} />);
  return { ...utils, props };
}

describe("EditorToolbar", () => {
  it("shows every tool as a toggle, with the current one pressed", async () => {
    const user = userEvent.setup();
    const { props } = setup({ tool: "ink" });
    expect(
      screen.getByRole("toolbar", { name: "Editing tools" }),
    ).toBeInTheDocument();
    for (const t of TOOLS) {
      expect(screen.getByRole("button", { name: t.label })).toHaveAttribute(
        "aria-pressed",
        String(t.id === "ink"),
      );
    }
    await user.click(screen.getByRole("button", { name: "White-out" }));
    expect(props.onToolChange).toHaveBeenCalledWith("whiteout");
  });

  it("wires undo, redo, download and open-another", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(props.onUndo).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    expect(props.onDownload).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Open another/ }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("hands over a picked image and allows picking it again", () => {
    const { props } = setup();
    const input = screen.getByTestId("image-input") as HTMLInputElement;
    const file = new File(["x"], "sig.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onPickImage).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });

  it("opens the image picker from the Image button", async () => {
    const user = userEvent.setup();
    setup();
    const click = vi.spyOn(screen.getByTestId("image-input"), "click");
    await user.click(screen.getByRole("button", { name: "Add image" }));
    expect(click).toHaveBeenCalled();
  });

  it("locks editing while saving but still lets the user leave", () => {
    setup({ saving: true });
    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Text" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Open another/ })).toBeEnabled();
  });
});
