import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OCR_OPTIONS } from "./core/options";
import { OcrSettingsForm } from "./ocr-settings";

describe("OcrSettingsForm", () => {
  it("renders English and Indian languages and toggles selections", () => {
    const onChange = vi.fn();
    render(
      <OcrSettingsForm
        options={DEFAULT_OCR_OPTIONS}
        onChange={onChange}
        validationError={null}
      />,
    );

    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("Hindi")).toBeInTheDocument();
    expect(screen.getByText("Tamil")).toBeInTheDocument();
    expect(screen.getByText("Telugu")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Hindi/i));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_OCR_OPTIONS,
      languages: ["eng", "hin"],
    });
  });

  it("toggles redoExistingText, enhanceScan, DPI, and displays validation errors", () => {
    const onChange = vi.fn();
    render(
      <OcrSettingsForm
        options={DEFAULT_OCR_OPTIONS}
        onChange={onChange}
        validationError="Select at least one language for OCR."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select at least one language for OCR.",
    );

    fireEvent.change(screen.getByLabelText(/Recognition resolution/i), {
      target: { value: "200" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_OCR_OPTIONS,
      dpi: 200,
    });

    fireEvent.click(
      screen.getByLabelText(/Redo OCR on pages that already have text/i),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_OCR_OPTIONS,
      redoExistingText: true,
    });

    fireEvent.click(
      screen.getByLabelText(/Enhance faded or low-contrast scans/i),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_OCR_OPTIONS,
      enhanceScan: true,
    });
  });
});
