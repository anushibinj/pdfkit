import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OcrTool from "./index";
import { DEFAULT_OCR_OPTIONS } from "./core/options";
import { buildOcrReport } from "./core/report";
import { useOcrPdf } from "./use-ocr-pdf";

vi.mock("./use-ocr-pdf", () => ({
  useOcrPdf: vi.fn(),
}));

describe("OcrTool UI", () => {
  it("renders dropzone initially when queue is empty", () => {
    vi.mocked(useOcrPdf).mockReturnValue({
      state: {
        items: [],
        options: DEFAULT_OCR_OPTIONS,
        isProcessing: false,
        inspectedTextItemId: null,
      },
      addFiles: vi.fn(),
      removeFile: vi.fn(),
      setOptions: vi.fn(),
      runAll: vi.fn(),
      submitPassword: vi.fn(),
      dismissPassword: vi.fn(),
      reopenPassword: vi.fn(),
      inspectText: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<OcrTool />);
    expect(
      screen.getByText(/Drop scanned PDFs or images here/i),
    ).toBeInTheDocument();
  });

  it("renders queued file, settings, and completed text panel + download", () => {
    const runAll = vi.fn();
    const inspectText = vi.fn();
    const file = new File([new Uint8Array([1, 2, 3])], "hindi.pdf", {
      type: "application/pdf",
    });
    const report = buildOcrReport([
      {
        pageIndex: 0,
        status: "ocr",
        text: "नमस्ते भारत",
        confidence: 93,
        wordCount: 2,
      },
    ]);

    vi.mocked(useOcrPdf).mockReturnValue({
      state: {
        items: [
          {
            id: "1",
            file,
            status: {
              kind: "completed",
              pdf: new Blob([new Uint8Array([37, 80, 68, 70])], {
                type: "application/pdf",
              }),
              report,
              wasImageInput: false,
            },
          },
        ],
        options: { ...DEFAULT_OCR_OPTIONS, languages: ["eng", "hin"] },
        isProcessing: false,
        inspectedTextItemId: "1",
      },
      addFiles: vi.fn(),
      removeFile: vi.fn(),
      setOptions: vi.fn(),
      runAll,
      submitPassword: vi.fn(),
      dismissPassword: vi.fn(),
      reopenPassword: vi.fn(),
      inspectText,
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<OcrTool />);
    expect(screen.getByText("hindi.pdf")).toBeInTheDocument();
    expect(screen.getByText("Searchable")).toBeInTheDocument();
    expect(screen.getByLabelText("Extracted OCR text")).toHaveValue(
      "नमस्ते भारत",
    );
    expect(
      screen.getByRole("button", { name: /Download PDF/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide text/i }));
    expect(inspectText).toHaveBeenCalledWith(null);
  });
});
