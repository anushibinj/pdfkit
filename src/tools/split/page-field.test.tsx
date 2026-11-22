import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageField } from "./page-field";

function setup(overrides: Partial<Parameters<typeof PageField>[0]> = {}) {
  const props = {
    label: "Pages to remove",
    value: "",
    onChange: vi.fn(),
    onClear: vi.fn(),
    error: null,
    ...overrides,
  };
  render(<PageField {...props} />);
  return props;
}

describe("PageField", () => {
  it("reports typing and has a hint", async () => {
    const user = userEvent.setup();
    const props = setup();
    const field = screen.getByLabelText("Pages to remove");
    expect(field).toHaveAccessibleDescription(/Click pages below/);
    await user.type(field, "2");
    expect(props.onChange).toHaveBeenLastCalledWith("2");
  });

  it("clears, but only when there is something to clear", () => {
    const empty = setup();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(empty.onClear).not.toHaveBeenCalled();
  });

  it("calls onClear", async () => {
    const user = userEvent.setup();
    const props = setup({ value: "1-3" });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it("marks and describes a typing mistake", () => {
    setup({ value: "x", error: "“x” is not a page number or a range such as 2-5." });
    const field = screen.getByLabelText("Pages to remove");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/“x” is not a page number/);
  });
});
