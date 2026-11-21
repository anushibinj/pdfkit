import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SplitOptions } from "./split-options";

function setup(overrides: Partial<Parameters<typeof SplitOptions>[0]> = {}) {
  const props = {
    method: "every" as const,
    onMethodChange: vi.fn(),
    everyN: "1",
    onEveryNChange: vi.fn(),
    ranges: "",
    onRangesChange: vi.fn(),
    error: null,
    ...overrides,
  };
  render(<SplitOptions {...props} />);
  return props;
}

describe("SplitOptions", () => {
  it("edits pages per file, with the ranges field disabled", async () => {
    const user = userEvent.setup();
    const props = setup();
    expect(screen.getByLabelText("Ranges, one file each")).toBeDisabled();
    await user.type(screen.getByLabelText("Pages per file"), "0");
    expect(props.onEveryNChange).toHaveBeenLastCalledWith("10");
  });

  it("switches to custom ranges and edits them", async () => {
    const user = userEvent.setup();
    const props = setup({ method: "ranges" });
    expect(screen.getByLabelText("Pages per file")).toBeDisabled();
    await user.type(screen.getByLabelText("Ranges, one file each"), "1");
    expect(props.onRangesChange).toHaveBeenLastCalledWith("1");
    await user.click(screen.getByRole("radio", { name: "Every" }));
    expect(props.onMethodChange).toHaveBeenLastCalledWith("every");
  });

  it("shows the plan's error on the active field", () => {
    setup({ method: "ranges", ranges: "9", error: "There is no page 9: this PDF has 3 pages." });
    const field = screen.getByLabelText("Ranges, one file each");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("There is no page 9: this PDF has 3 pages.");
    expect(screen.getByLabelText("Pages per file")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
  });

  it("disables everything while files are being made", () => {
    setup({ disabled: true });
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByLabelText("Pages per file")).toBeDisabled();
  });
});
