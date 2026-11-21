import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorField, NumberField, RangeField } from "./form-fields";

describe("NumberField", () => {
  it("reports clamped numbers and tolerates an empty field while typing", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        label="Size"
        value={12}
        limits={{ min: 4, max: 144 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Size");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: "999" } });
    expect(onChange).toHaveBeenLastCalledWith(144);
    fireEvent.blur(input);
    expect(input).toHaveValue(12); // back to the value in use
  });
});

describe("ColorField", () => {
  it("shows and reports colours", () => {
    const onChange = vi.fn();
    render(
      <ColorField
        label="Colour"
        value={{ r: 255, g: 0, b: 0 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Colour");
    expect(input).toHaveValue("#ff0000");
    fireEvent.change(input, { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenCalledWith({ r: 0, g: 255, b: 0 });
  });
});

describe("RangeField", () => {
  it("shows the formatted value and reports changes as numbers", () => {
    const onChange = vi.fn();
    render(
      <RangeField
        label="Opacity"
        value={0.3}
        min={0.05}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={onChange}
      />,
    );
    const slider = screen.getByLabelText("Opacity");
    expect(slider).toHaveAttribute("aria-valuetext", "30%");
    expect(screen.getByText("30%")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });
});
