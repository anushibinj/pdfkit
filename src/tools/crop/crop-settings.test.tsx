import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NO_MARGINS, mmToPoints } from "./core/margins";
import { DEFAULT_SETTINGS } from "./core/settings";
import { CropSettingsForm, marginFieldValue } from "./crop-settings";

function setup(props: Partial<Parameters<typeof CropSettingsForm>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <CropSettingsForm
      settings={DEFAULT_SETTINGS}
      onChange={onChange}
      rangeError={null}
      {...props}
    />,
  );
  return { onChange };
}

describe("marginFieldValue", () => {
  it("shows millimetres to 2 decimals, and empty for NaN", () => {
    expect(marginFieldValue(mmToPoints(12.345))).toBe(12.35);
    expect(marginFieldValue(0)).toBe(0);
    expect(marginFieldValue(Number.NaN)).toBe("");
  });
});

describe("CropSettingsForm", () => {
  it("turns typed millimetres into points for each edge", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("Bottom"), {
      target: { value: "5" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      margins: { ...NO_MARGINS, bottom: mmToPoints(5) },
    });
  });

  it("switches to a page range, which is only editable then", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    expect(screen.getByLabelText(/Pages to crop/)).toBeDisabled();
    await user.click(screen.getByLabelText("Only these pages"));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      pages: "range",
    });
  });

  it("shows a range error next to the range", () => {
    setup({
      settings: { ...DEFAULT_SETTINGS, pages: "range", range: "x" },
      rangeError: "Bad range.",
    });
    const range = screen.getByLabelText(/Pages to crop/);
    expect(range).toHaveAttribute("aria-invalid", "true");
    expect(range).toHaveAccessibleDescription("Bad range.");
  });

  it("explains what removing does, and what hiding leaves", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    expect(
      screen.getByText(/Deletes the text, pictures and drawings/),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText("Remove what's outside"));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      removeOutside: false,
    });
    setup({ settings: { ...DEFAULT_SETTINGS, removeOutside: false } });
    expect(screen.getByText(/only hidden/)).toBeInTheDocument();
  });

  it("disables everything while disabled", () => {
    setup({ disabled: true });
    expect(screen.getByLabelText("Top")).toBeDisabled();
    expect(screen.getByLabelText("Remove what's outside")).toBeDisabled();
  });
});
