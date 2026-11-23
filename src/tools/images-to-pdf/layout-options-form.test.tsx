import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT_OPTIONS } from "./core/options";
import { LayoutOptionsForm } from "./layout-options-form";

describe("LayoutOptionsForm", () => {
  it("shows orientation and scaling controls for fixed paper sizes and hides them for fit", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LayoutOptionsForm value={DEFAULT_LAYOUT_OPTIONS} onChange={onChange} />,
    );

    expect(screen.getByLabelText("Paper size")).toBeInTheDocument();
    expect(screen.getByLabelText("Orientation")).toBeInTheDocument();
    expect(screen.getByLabelText("Margin (mm)")).toBeInTheDocument();
    expect(screen.getByLabelText("Image scaling")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Paper size"), {
      target: { value: "fit" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYOUT_OPTIONS,
      pageSize: "fit",
    });

    rerender(
      <LayoutOptionsForm
        value={{ ...DEFAULT_LAYOUT_OPTIONS, pageSize: "fit" }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByLabelText("Orientation")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Image scaling")).not.toBeInTheDocument();
  });

  it("propagates orientation, margin, and scaling changes", () => {
    const onChange = vi.fn();
    render(
      <LayoutOptionsForm value={DEFAULT_LAYOUT_OPTIONS} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("Orientation"), {
      target: { value: "landscape" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYOUT_OPTIONS,
      orientation: "landscape",
    });

    fireEvent.change(screen.getByLabelText("Image scaling"), {
      target: { value: "actual" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYOUT_OPTIONS,
      scaleMode: "actual",
    });
  });
});
