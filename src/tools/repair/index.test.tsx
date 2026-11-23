import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RepairReport } from "./core/model";
import RepairTool, { StatusFor } from "./index";
import * as useRepairPdfModule from "./use-repair-pdf";

const sampleReport: RepairReport = {
  headerRepaired: true,
  eofRepaired: false,
  xrefReconstructed: true,
  trailerReconstructed: false,
  objectsRecovered: 4,
  streamsRepaired: 0,
  pagesRecovered: 1,
  issues: ["Header fixed"],
};

const mockFile = new File(["dummy"], "damaged.pdf", {
  type: "application/pdf",
});

describe("StatusFor", () => {
  it("renders appropriate badge for each state", () => {
    const { rerender } = render(<StatusFor state={{ kind: "idle" }} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();

    rerender(<StatusFor state={{ kind: "ready", file: mockFile }} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();

    rerender(
      <StatusFor
        state={{ kind: "repairing", file: mockFile, progress: 0.5 }}
      />,
    );
    expect(screen.getByText("Repairing…")).toBeInTheDocument();

    rerender(
      <StatusFor
        state={{
          kind: "repaired",
          file: mockFile,
          pdf: new Blob(),
          pageCount: 1,
          report: sampleReport,
        }}
      />,
    );
    expect(screen.getByText("Repaired")).toBeInTheDocument();

    rerender(
      <StatusFor
        state={{ kind: "password-required", file: mockFile }}
      />,
    );
    expect(screen.getByText("Password needed")).toBeInTheDocument();

    rerender(
      <StatusFor
        state={{ kind: "unrecoverable", file: mockFile, reason: "corrupt" }}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});

describe("RepairTool", () => {
  it("renders Dropzone in idle state", () => {
    vi.spyOn(useRepairPdfModule, "useRepairPdf").mockReturnValue({
      state: { kind: "idle" },
      selectFile: vi.fn(),
      repair: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<RepairTool />);
    expect(screen.getByText("Drop your damaged PDF here")).toBeInTheDocument();
  });

  it("renders Ready state with Repair button", () => {
    vi.spyOn(useRepairPdfModule, "useRepairPdf").mockReturnValue({
      state: { kind: "ready", file: mockFile },
      selectFile: vi.fn(),
      repair: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<RepairTool />);
    expect(screen.getByText("damaged.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /repair pdf/i })).toBeInTheDocument();
  });

  it("renders Repairing state with progress bar and cancel button", () => {
    vi.spyOn(useRepairPdfModule, "useRepairPdf").mockReturnValue({
      state: {
        kind: "repairing",
        file: mockFile,
        progress: 0.45,
        stage: "Carving objects…",
      },
      selectFile: vi.fn(),
      repair: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<RepairTool />);
    expect(screen.getByText("Carving objects…")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("renders password prompt when document is encrypted", () => {
    vi.spyOn(useRepairPdfModule, "useRepairPdf").mockReturnValue({
      state: { kind: "password-required", file: mockFile },
      selectFile: vi.fn(),
      repair: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<RepairTool />);
    expect(
      screen.getByText("This document is password protected"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /unlock & repair/i }),
    ).toBeInTheDocument();
  });

  it("renders success summary and download button when repaired", () => {
    vi.spyOn(useRepairPdfModule, "useRepairPdf").mockReturnValue({
      state: {
        kind: "repaired",
        file: mockFile,
        pdf: new Blob(["repaired"], { type: "application/pdf" }),
        pageCount: 1,
        report: sampleReport,
      },
      selectFile: vi.fn(),
      repair: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<RepairTool />);
    expect(screen.getByText("PDF successfully repaired")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download repaired pdf/i }),
    ).toBeInTheDocument();
  });

  it("renders unrecoverable message with Try Again button", () => {
    vi.spyOn(useRepairPdfModule, "useRepairPdf").mockReturnValue({
      state: {
        kind: "unrecoverable",
        file: mockFile,
        reason: "No indirect objects detected",
      },
      selectFile: vi.fn(),
      repair: vi.fn(),
      cancel: vi.fn(),
      clear: vi.fn(),
    });

    render(<RepairTool />);
    expect(screen.getByText("Unable to repair document")).toBeInTheDocument();
    expect(
      screen.getByText("No indirect objects detected"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });
});
