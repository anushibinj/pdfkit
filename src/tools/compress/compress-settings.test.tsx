import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPRESS_OPTIONS } from "./core/options";
import { CompressSettingsForm } from "./compress-settings";

describe("CompressSettingsForm", () => {
  it("renders all five compression presets and switches modes", () => {
    const onChange = vi.fn();
    render(
      <CompressSettingsForm
        options={DEFAULT_COMPRESS_OPTIONS}
        onChange={onChange}
        validationError={null}
      />,
    );

    expect(screen.getByLabelText(/Lossless/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Balanced/i)).toBeChecked();
    expect(screen.getByLabelText(/Small/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Target size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Custom/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Target size/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "target-size" }),
    );
  });

  it("shows target size input in target-size mode and custom fields in custom mode", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CompressSettingsForm
        options={{ ...DEFAULT_COMPRESS_OPTIONS, preset: "target-size" }}
        onChange={onChange}
        validationError={null}
      />,
    );

    const targetInput = screen.getByLabelText(/Make it under \(MB\)/i);
    fireEvent.change(targetInput, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ targetSizeMb: 1.5 }),
    );

    rerender(
      <CompressSettingsForm
        options={{ ...DEFAULT_COMPRESS_OPTIONS, preset: "custom" }}
        onChange={onChange}
        validationError="DPI must be between 36 and 600."
      />,
    );
    expect(screen.getByLabelText(/Max image DPI/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Convert images to grayscale/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("DPI must be between 36 and 600.");
  });
});
