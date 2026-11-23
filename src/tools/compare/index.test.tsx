import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompareSummary } from "./core/model";
import CompareTool from "./index";
import type { PdfCompareController } from "./use-pdf-compare";

const mockSummary: CompareSummary = {
  leftFileName: "contract-v1.pdf",
  rightFileName: "contract-v2.pdf",
  leftPageCount: 2,
  rightPageCount: 2,
  totalChanges: 2,
  addedWords: 3,
  removedWords: 1,
  scannedPagesCount: 1,
  pairs: [
    {
      pairIndex: 0,
      leftIndex: 0,
      rightIndex: 0,
      status: "matched",
      similarity: 0.9,
      leftHasText: true,
      rightHasText: true,
      leftInfo: { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
      rightInfo: { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
      changes: [
        {
          id: "p0-c0",
          pairIndex: 0,
          kind: "modified",
          leftText: "1250",
          rightText: "1520",
          leftUserRects: [],
          rightUserRects: [],
          leftViewRects: [{ left: 0.2, top: 0.2, right: 0.3, bottom: 0.23 }],
          rightViewRects: [{ left: 0.2, top: 0.2, right: 0.3, bottom: 0.23 }],
          anchorY: 0.2,
        },
      ],
    },
    {
      pairIndex: 1,
      leftIndex: 1,
      rightIndex: 1,
      status: "matched",
      similarity: 0.8,
      leftHasText: false,
      rightHasText: true,
      leftInfo: { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
      rightInfo: { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
      changes: [
        {
          id: "p1-c0",
          pairIndex: 1,
          kind: "added",
          leftText: "",
          rightText: "new clause",
          leftUserRects: [],
          rightUserRects: [],
          leftViewRects: [],
          rightViewRects: [{ left: 0.1, top: 0.4, right: 0.4, bottom: 0.43 }],
          anchorY: 0.4,
        },
      ],
    },
  ],
};

const mockState: PdfCompareController = {
  left: { kind: "ready", fileName: "contract-v1.pdf", pageCount: 2, scannedPages: 1 },
  right: { kind: "ready", fileName: "contract-v2.pdf", pageCount: 2, scannedPages: 0 },
  summary: mockSummary,
  reportJob: { kind: "idle" },
  openFile: vi.fn(async () => {}),
  submitPassword: vi.fn(async () => {}),
  clearSide: vi.fn(),
  resetAll: vi.fn(),
  swapSides: vi.fn(async () => {}),
  renderPage: vi.fn(async () => ({
    status: "rendered" as const,
    width: 200,
    height: 260,
    pixels: new ArrayBuffer(200 * 260 * 4),
  })),
  computeVisualDiff: vi.fn(async () => ({
    status: "visual-diff" as const,
    pixels: new ArrayBuffer(200 * 260 * 4),
    summary: {
      pairIndex: 0,
      width: 200,
      height: 260,
      leftWidth: 200,
      leftHeight: 260,
      rightWidth: 200,
      rightHeight: 260,
      sizeMismatch: false,
      changedPixels: 150,
      totalPixels: 52000,
      percentChanged: 0.29,
      regions: [{ left: 0.1, top: 0.1, right: 0.3, bottom: 0.3, pixelCount: 150 }],
    },
  })),
  exportReport: vi.fn(async () => ({
    status: "report" as const,
    data: new ArrayBuffer(16),
  })),
};

vi.mock("./use-pdf-compare", () => ({
  usePdfCompare: () => mockState,
}));

vi.mock("@/lib/download", () => ({
  downloadBlob: vi.fn(),
}));

describe("CompareTool UI", () => {
  it("shows scanned-page notice, change count, navigates changes, switches to Visual mode, and exports report", async () => {
    render(<CompareTool />);

    expect(screen.getByText(/1 page has no extractable text layer/i)).toBeInTheDocument();
    expect(screen.getByText("2 text changes")).toBeInTheDocument();
    expect(screen.getByText("+3 added")).toBeInTheDocument();
    expect(screen.getByText("-1 removed")).toBeInTheDocument();

    // Navigate forward through changes across pairs
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText(/Pair 2 of 2/)).toBeInTheDocument();

    // Switch to Visual mode
    fireEvent.click(screen.getByRole("button", { name: /Visual/i }));
    await waitFor(() => {
      expect(mockState.computeVisualDiff).toHaveBeenCalled();
    });

    // Export report PDF
    fireEvent.click(screen.getByRole("button", { name: /Export Report PDF/i }));
    await waitFor(() => {
      expect(mockState.exportReport).toHaveBeenCalledTimes(1);
    });
  });

  it("reuses cached visual page renders on threshold change and draws them when toggling side-by-side layout", async () => {
    vi.mocked(mockState.renderPage).mockClear();
    vi.mocked(mockState.computeVisualDiff).mockClear();

    render(<CompareTool />);

    // Initial Text view renders 2 panes (left + right).
    await waitFor(() => {
      expect(mockState.renderPage).toHaveBeenCalledTimes(2);
    });

    vi.mocked(mockState.renderPage).mockClear();

    // Switch to Visual mode: computes visual diff and renders both sides once.
    fireEvent.click(screen.getByRole("button", { name: /Visual/i }));
    await waitFor(() => {
      expect(mockState.computeVisualDiff).toHaveBeenCalledTimes(1);
      expect(mockState.renderPage).toHaveBeenCalledTimes(2);
    });

    // Change threshold sensitivity: re-computes diff, but MUST NOT re-render left/right pages.
    fireEvent.click(screen.getByRole("button", { name: "Strict" }));
    await waitFor(() => {
      expect(mockState.computeVisualDiff).toHaveBeenCalledTimes(2);
    });
    expect(mockState.renderPage).toHaveBeenCalledTimes(2);

    // Toggle to Side-by-Side layout: newly mounted canvases must receive cached dimensions.
    fireEvent.click(screen.getByRole("button", { name: "Side by side + diff" }));
    await waitFor(() => {
      const canvases = document.querySelectorAll("canvas");
      expect(canvases.length).toBe(3);
      // drawPixels sets width=200 and height=260 from mockState.renderPage
      expect(canvases[0]).toHaveAttribute("width", "200");
      expect(canvases[2]).toHaveAttribute("width", "200");
    });
    expect(mockState.renderPage).toHaveBeenCalledTimes(2);
  });

  it("displays accessible error alerts when page rendering or visual diff fails", async () => {
    vi.mocked(mockState.renderPage).mockResolvedValueOnce({
      status: "error",
      reason: "failed",
      message: "Left page render failed",
    });

    render(<CompareTool />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Left page render failed",
    );

    vi.mocked(mockState.computeVisualDiff).mockResolvedValueOnce({
      status: "error",
      reason: "failed",
      message: "Visual comparison timed out",
    });

    fireEvent.click(screen.getByRole("button", { name: /Visual/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Visual comparison timed out",
    );
  });
});
