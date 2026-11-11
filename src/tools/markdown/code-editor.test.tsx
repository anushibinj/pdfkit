import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeEditor } from "./code-editor";

describe("CodeEditor", () => {
  it("is a labelled text area that reports edits", () => {
    const onChange = vi.fn();
    render(<CodeEditor label="CSS" value="p{}" onChange={onChange} />);
    const box = screen.getByLabelText("CSS");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveValue("p{}");
    fireEvent.change(box, { target: { value: "h1{}" } });
    expect(onChange).toHaveBeenCalledWith("h1{}");
  });

  it("turns off spell checking and shows extra actions", () => {
    render(
      <CodeEditor
        label="Markdown"
        value=""
        onChange={() => {}}
        actions={<button>Reset</button>}
      />,
    );
    expect(screen.getByLabelText("Markdown")).toHaveAttribute(
      "spellcheck",
      "false",
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });
});
