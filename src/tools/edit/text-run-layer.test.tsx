import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TextRun } from "./core/text-runs";
import { TextRunLayer } from "./text-run-layer";

const run = (id: string, text: string): TextRun => ({
  id,
  indices: [Number(id)],
  text,
  box: { left: 0, bottom: 98, right: 40, top: 108 },
  baseline: [1, 0, 0, 1, 0, 100],
  width: 40,
  fontSize: 10,
  style: { family: "sans", bold: false, italic: false },
  color: { r: 0, g: 0, b: 0 },
});

function setup(
  edits: Record<string, string> = {},
  editingRunId: string | null = null,
) {
  const onStart = vi.fn();
  const utils = render(
    <svg>
      <TextRunLayer
        runs={[run("1", "First"), run("2", "Second")]}
        edits={edits}
        editingRunId={editingRunId}
        toView={() => [1, 0, 0, 1, 7, 9]}
        onStart={onStart}
      />
    </svg>,
  );
  return { ...utils, onStart };
}

describe("TextRunLayer", () => {
  it("puts a focusable target over each line's glyphs", () => {
    setup();
    const first = screen.getByRole("button", { name: "Edit text: First" });
    expect(first.getAttribute("transform")).toBe("matrix(1 0 0 1 7 9)");
    // glyphs 2 pt below to 8 pt above the baseline, in y-down space
    expect(first.getAttribute("y")).toBe("-8");
    expect(first.getAttribute("height")).toBe("10");
    expect(first.getAttribute("width")).toBe("40");
    expect(first).toHaveAttribute("tabindex", "0");
  });

  it("starts editing on a primary press, Enter or Space", () => {
    const { onStart } = setup();
    const target = screen.getByRole("button", { name: "Edit text: Second" });
    fireEvent.pointerDown(target, { button: 2 });
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.pointerDown(target, { button: 0 });
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.keyDown(target, { key: " " });
    fireEvent.keyDown(target, { key: "a" });
    expect(onStart.mock.calls).toEqual([["2"], ["2"], ["2"]]);
  });

  it("names edited lines by their new text and marks them", () => {
    setup({ "1": "Changed", "2": "" });
    const changed = screen.getByRole("button", { name: "Edit text: Changed" });
    expect(changed.getAttribute("class")).toContain("stroke-blue-600/40");
    expect(
      screen.getByRole("button", { name: "Edit text (deleted line)" }),
    ).toBeInTheDocument();
  });

  it("names a line by its whole text, however long", () => {
    const long = "A line that is clearly longer than thirty characters.";
    render(
      <svg>
        <TextRunLayer
          runs={[run("3", ` ${long} `)]}
          edits={{}}
          editingRunId={null}
          toView={() => [1, 0, 0, 1, 0, 0]}
          onStart={vi.fn()}
        />
      </svg>,
    );
    expect(
      screen.getByRole("button", { name: `Edit text: ${long}` }),
    ).toBeInTheDocument();
  });

  it("leaves out the line being edited", () => {
    setup({}, "1");
    expect(
      screen.queryByRole("button", { name: "Edit text: First" }),
    ).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
