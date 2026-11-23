import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildOcrReport } from "./core/report";
import { TextResultPanel } from "./text-result-panel";

describe("TextResultPanel", () => {
  it("renders recognized text, copies to clipboard, and closes", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });

    const onClose = vi.fn();
    const report = buildOcrReport([
      {
        pageIndex: 0,
        status: "ocr",
        text: "नमस्ते India",
        confidence: 91,
        wordCount: 2,
      },
    ]);

    render(
      <TextResultPanel
        fileName="hindi-scan.pdf"
        report={report}
        onClose={onClose}
      />,
    );

    expect(screen.getByLabelText("Extracted OCR text")).toHaveValue(
      "नमस्ते India",
    );

    fireEvent.click(screen.getByRole("button", { name: /Copy text/i }));
    expect(writeText).toHaveBeenCalledWith("नमस्ते India");

    fireEvent.click(
      screen.getByRole("button", { name: /Close recognized text panel/i }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
