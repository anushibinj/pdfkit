import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageSettings } from "./page-settings";

describe("PageSettings", () => {
  it("shows the current values", () => {
    render(
      <PageSettings
        value={{ size: "Legal", marginMm: 15 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Paper size")).toHaveValue("Legal");
    expect(screen.getByLabelText("Margin (mm)")).toHaveValue(15);
  });

  it("reports a new paper size", () => {
    const onChange = vi.fn();
    render(
      <PageSettings value={{ size: "A4", marginMm: 20 }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Paper size"), {
      target: { value: "Letter" },
    });
    expect(onChange).toHaveBeenCalledWith({ size: "Letter", marginMm: 20 });
  });

  it("reports a new margin, and NaN while the field is empty", () => {
    const onChange = vi.fn();
    render(
      <PageSettings value={{ size: "A4", marginMm: 20 }} onChange={onChange} />,
    );
    const margin = screen.getByLabelText("Margin (mm)");
    fireEvent.change(margin, { target: { value: "12" } });
    expect(onChange).toHaveBeenLastCalledWith({ size: "A4", marginMm: 12 });
    fireEvent.change(margin, { target: { value: "" } });
    expect(onChange.mock.lastCall?.[0].marginMm).toBeNaN();
  });

  it("renders an empty field for a NaN margin", () => {
    render(
      <PageSettings
        value={{ size: "A4", marginMm: Number.NaN }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Margin (mm)")).toHaveValue(null);
  });
});
