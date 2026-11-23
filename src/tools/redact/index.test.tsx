import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RedactTool from "./index";

const openFile = vi.fn(async () => {});
const submitPassword = vi.fn(async () => {});
const close = vi.fn();
const renderPage = vi.fn(async () => ({
  status: "rendered" as const,
  width: 10,
  height: 10,
  pixels: new ArrayBuffer(400),
}));
const extractTextUnderBox = vi.fn(async () => "manual secret");
const search = vi.fn(async () => [
  {
    pageIndex: 0,
    box: { left: 50, bottom: 700, right: 150, top: 720 },
    term: "alice@example.com",
    source: "email" as const,
    label: "Email",
    enabled: true,
  },
]);
const applyRedactions = vi.fn(async () => {});
const resetJob = vi.fn();

const mockState = {
  status: { kind: "empty" } as
    | { kind: "empty" }
    | {
        kind: "ready";
        fileName: string;
        pages: {
          box: { left: 0; bottom: 0; right: 612; top: 792 };
          rotation: 0;
        }[];
      },
  job: { kind: "idle" } as
    | { kind: "idle" }
    | {
        kind: "done";
        data: ArrayBuffer;
        report: {
          pagesRedacted: 1;
          marksApplied: 1;
          textObjectsRemoved: 1;
          textObjectsSplit: 0;
          imagesModified: 0;
          pathsRemoved: 0;
          annotationsRemoved: 0;
          pagesRasterized: 0;
          sanitize: {
            metadataEntriesRemoved: 0;
            xmpStreamsRemoved: 0;
            attachmentsRemoved: 0;
            javascriptActionsRemoved: 0;
            hiddenLayersRemoved: 0;
            bookmarksCleaned: 0;
            annotationsRemoved: 0;
            formValuesCleared: 0;
            objectsPruned: 1;
          };
          verification: {
            verified: true;
            totalTerms: 1;
            remainingTerms: 0;
            leakedTerms: [];
            summary: "0 of 1 redacted terms remain";
          };
        };
      },
};

vi.mock("./use-pdf-redact", () => ({
  usePdfRedact: () => ({
    status: mockState.status,
    job: mockState.job,
    openFile,
    submitPassword,
    close,
    renderPage,
    extractTextUnderBox,
    search,
    applyRedactions,
    resetJob,
  }),
}));

describe("RedactTool", () => {
  it("shows dropzone when empty", () => {
    mockState.status = { kind: "empty" };
    mockState.job = { kind: "idle" };
    render(<RedactTool />);
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
  });

  it("searches, reviews marks, and triggers verified redaction", async () => {
    mockState.status = {
      kind: "ready",
      fileName: "report.pdf",
      pages: [{ box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 }],
    };
    mockState.job = { kind: "idle" };
    render(<RedactTool />);

    const applyBtn = screen.getByRole("button", {
      name: /apply 0 redactions/i,
    });
    expect(applyBtn).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /find matches/i }));
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });

    const enabledBtn = screen.getByRole("button", {
      name: /apply 1 redaction & verify/i,
    });
    expect(enabledBtn).toBeEnabled();
    fireEvent.click(enabledBtn);

    await waitFor(() => {
      expect(applyRedactions).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores stale async box-text extraction results after resetting the document", async () => {
    let resolveBox!: (value: string) => void;
    extractTextUnderBox.mockImplementationOnce(
      () =>
        new Promise<string>((r) => {
          resolveBox = r;
        }),
    );

    mockState.status = {
      kind: "ready",
      fileName: "first.pdf",
      pages: [{ box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 }],
    };
    mockState.job = { kind: "idle" };
    render(<RedactTool />);

    const svg = screen.getByRole("img", { name: /redaction canvas for page 1/i });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 612, height: 792 }),
    });
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(svg, { button: 0, pointerId: 1, clientX: 120, clientY: 60 });
    fireEvent.pointerUp(svg, { button: 0, pointerId: 1, clientX: 120, clientY: 60 });

    // User closes / switches PDFs before extractTextUnderBox resolves.
    fireEvent.click(screen.getByRole("button", { name: /open another pdf/i }));
    resolveBox("stale secret");

    await waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("stale secret")).not.toBeInTheDocument();
  });

  it("shows verified result screen when job is done", () => {
    mockState.status = {
      kind: "ready",
      fileName: "report.pdf",
      pages: [{ box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 }],
    };
    mockState.job = {
      kind: "done",
      data: new ArrayBuffer(10),
      report: {
        pagesRedacted: 1,
        marksApplied: 1,
        textObjectsRemoved: 1,
        textObjectsSplit: 0,
        imagesModified: 0,
        pathsRemoved: 0,
        annotationsRemoved: 0,
        pagesRasterized: 0,
        sanitize: {
          metadataEntriesRemoved: 0,
          xmpStreamsRemoved: 0,
          attachmentsRemoved: 0,
          javascriptActionsRemoved: 0,
          hiddenLayersRemoved: 0,
          bookmarksCleaned: 0,
          annotationsRemoved: 0,
          formValuesCleared: 0,
          objectsPruned: 1,
        },
        verification: {
          verified: true,
          totalTerms: 1,
          remainingTerms: 0,
          leakedTerms: [],
          summary: "0 of 1 redacted terms remain",
        },
      },
    };
    render(<RedactTool />);
    expect(screen.getByText("0 of 1 redacted terms remain")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download report-redacted\.pdf/i }),
    ).toBeInTheDocument();
  });
});
