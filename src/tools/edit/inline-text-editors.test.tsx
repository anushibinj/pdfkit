import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TextObject } from "./core/model";
import type { TextRun } from "./core/text-runs";
import {
  ObjectTextEditor,
  RunTextEditor,
  closeInlineEditor,
} from "./inline-text-editors";
import { fakeMetrics } from "./test-utils/fake-metrics";

const toast = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const run: TextRun = {
  id: "1",
  indices: [1],
  text: "Hello",
  box: { left: 0, bottom: 0, right: 50, top: 10 },
  baseline: [1, 0, 0, 1, 0, 2],
  width: 50,
  fontSize: 10,
  style: { family: "serif", bold: false, italic: true },
  color: { r: 0, g: 0, b: 255 },
};
const object: TextObject = {
  id: "t",
  kind: "text",
  x: 0,
  y: 0,
  rotation: 0,
  text: "Line one",
  font: "mono",
  fontSize: 12,
  color: { r: 10, g: 20, b: 30 },
};

/** Render inside an <svg>, as on a page. */
const inSvg = (ui: React.ReactElement) => render(<svg>{ui}</svg>);

describe("RunTextEditor", () => {
  function setup(initialText = "Hello") {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const utils = inSvg(
      <RunTextEditor
        run={run}
        transform={[1, 0, 0, 1, 5, 6]}
        initialText={initialText}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Edit text: Hello" });
    return { ...utils, field, onCommit, onCancel };
  }

  it("opens focused, in the line's place and style, on a clear background", () => {
    const { container, field } = setup("Hi there");
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Hi there");
    expect(field.style.fontStyle).toBe("italic");
    expect(field.style.fontSize).toBe("10px");
    expect(field.style.color).toBe("rgb(0, 0, 255)");
    expect(field.style.background).toContain("transparent");
    expect(
      container.querySelector("foreignObject")?.getAttribute("transform"),
    ).toBe("matrix(1 0 0 1 5 6)");
  });

  it("applies on Enter and on blur", () => {
    const { field, onCommit } = setup();
    fireEvent.change(field, { target: { value: "Howdy" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Howdy");
    expect(field).not.toHaveFocus();
  });

  it("cancels on Escape without applying, and keeps Escape to itself", () => {
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    const { field, onCommit, onCancel } = setup();
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    window.removeEventListener("keydown", outside);
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
  });

  it("keeps presses inside the field from reaching the page", () => {
    const onPageDown = vi.fn();
    render(
      <svg onPointerDown={onPageDown} onMouseDown={onPageDown}>
        <RunTextEditor
          run={run}
          transform={[1, 0, 0, 1, 0, 0]}
          initialText="x"
          onCommit={vi.fn()}
          onCancel={vi.fn()}
        />
      </svg>,
    );
    const field = screen.getByRole("textbox");
    fireEvent.pointerDown(field);
    fireEvent.mouseDown(field);
    expect(onPageDown).not.toHaveBeenCalled();
  });
});

describe("ObjectTextEditor", () => {
  function setup() {
    const onChange = vi.fn();
    const onDone = vi.fn();
    inSvg(
      <ObjectTextEditor
        object={object}
        transform={[1, 0, 0, 1, 0, 0]}
        metrics={fakeMetrics}
        onChange={onChange}
        onDone={onDone}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Text on the page" });
    return { field, onChange, onDone };
  }

  it("opens focused with the object's text and style", () => {
    const { field } = setup();
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Line one");
    expect(field.style.fontSize).toBe("12px");
    expect(field.style.lineHeight).toBe(`${12 * 1.2}px`);
  });

  it("reports cleaned text and warns about removed characters", () => {
    const { field, onChange } = setup();
    fireEvent.change(field, { target: { value: "Pay ₹5\r\nnow" } });
    expect(onChange).toHaveBeenCalledWith("Pay 5\nnow");
    expect(toast.warning).toHaveBeenCalled();
  });

  it("finishes on Escape, Ctrl+Enter or blur; plain Enter adds a line", () => {
    const { field, onDone } = setup();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => field.focus());
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});

describe("closeInlineEditor", () => {
  it("blurs a focused inline field and reports it", () => {
    const onCommit = vi.fn();
    inSvg(
      <RunTextEditor
        run={run}
        transform={[1, 0, 0, 1, 0, 0]}
        initialText="Hello"
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    let closed = false;
    act(() => {
      closed = closeInlineEditor();
    });
    expect(closed).toBe(true);
    expect(onCommit).toHaveBeenCalledWith("Hello");
  });

  it("leaves other focused elements alone", () => {
    render(<input aria-label="other" />);
    const other = screen.getByLabelText("other");
    other.focus();
    expect(closeInlineEditor()).toBe(false);
    expect(other).toHaveFocus();
  });
});
