import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorField, NumberField } from "./form-fields";

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
