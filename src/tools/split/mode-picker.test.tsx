import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModePicker } from "./mode-picker";

describe("ModePicker", () => {
  it("shows the three modes as radio buttons with the current one checked", () => {
    render(<ModePicker mode="extract" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "What to do" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual([
      "split",
      "extract",
      "remove",
    ]);
    expect(screen.getByRole("radio", { name: "Extract pages" })).toBeChecked();
  });

  it("reports a click, and arrow keys move between modes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModePicker mode="split" onChange={onChange} />);
    await user.click(screen.getByText("Remove pages"));
    expect(onChange).toHaveBeenLastCalledWith("remove");
    screen.getByRole("radio", { name: "Split" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("extract");
  });

  it("can be disabled", () => {
    render(<ModePicker mode="split" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });
});
