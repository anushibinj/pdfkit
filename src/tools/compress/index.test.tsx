import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CompressTool from "./index";
import { DEFAULT_COMPRESS_OPTIONS } from "./core/options";
import type { CompressState } from "./compress-state";
import type { UseCompressPdfReturn } from "./use-compress-pdf";

const mockHookState: { current: UseCompressPdfReturn } = {
  current: {
    state: {
      items: [],
      options: DEFAULT_COMPRESS_OPTIONS,
      isCompressing: false,
      preview: null,
    },
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    setOptions: vi.fn(),
    compressAll: vi.fn(async () => {}),
    submitPassword: vi.fn(async () => {}),
    dismissPassword: vi.fn(),
    reopenPassword: vi.fn(),
    openPreview: vi.fn(async () => {}),
    closePreview: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
  },
};

vi.mock("./use-compress-pdf", () => ({
  useCompressPdf: () => mockHookState.current,
}));

function setHookState(partial: Partial<CompressState>) {
  mockHookState.current = {
    ...mockHookState.current,
    state: {
      items: [],
      options: DEFAULT_COMPRESS_OPTIONS,
      isCompressing: false,
      preview: null,
      ...partial,
    },
  };
}

describe("CompressTool UI", () => {
  it("renders dropzone initially when no files are added", () => {
    setHookState({});
    render(<CompressTool />);
    expect(screen.getByText(/Drop PDF files here/i)).toBeInTheDocument();
  });

  it("renders batch file list, size reductions, preview and download buttons", () => {
    const compressAll = vi.fn(async () => {});
    const openPreview = vi.fn(async () => {});
    setHookState({
      items: [
        {
          id: "1",
          file: new File([new Uint8Array(1024 * 1024)], "big.pdf", {
            type: "application/pdf",
          }),
          status: {
            kind: "compressed",
            pdf: new Blob(["ok"], { type: "application/pdf" }),
            pageCount: 2,
            originalBytes: 1_000_000,
            compressedBytes: 400_000,
            report: {
              originalBytes: 1_000_000,
              compressedBytes: 400_000,
              imagesInspected: 2,
              imagesReencoded: 2,
              imagesDownsampled: 1,
              imagesDeduplicated: 0,
              imagesSkippedLarger: 0,
              flateStreamsRecompressed: 1,
              objectsRemoved: 0,
              transparencyPreserved: 0,
              notes: [],
            },
            appliedConfig: {
              lossless: false,
              targetDpi: 150,
              quality: 0.75,
              grayscale: false,
            },
            targetEvaluation: {
              targetBytes: 500_000,
              targetMet: true,
              attempts: 2,
              appliedConfig: {
                lossless: false,
                targetDpi: 150,
                quality: 0.75,
                grayscale: false,
              },
            },
          },
        },
        {
          id: "2",
          file: new File([new Uint8Array(200_000)], "second.pdf", {
            type: "application/pdf",
          }),
          status: { kind: "ready" },
        },
      ],
    });
    mockHookState.current.compressAll = compressAll;
    mockHookState.current.openPreview = openPreview;

    render(<CompressTool />);

    expect(screen.getByText("big.pdf")).toBeInTheDocument();
    expect(screen.getByText(/-60%/)).toBeInTheDocument();
    expect(screen.getByText(/Target size met/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    expect(openPreview).toHaveBeenCalledWith("1", 0);

    fireEvent.click(screen.getByRole("button", { name: /Compress 1 PDF$/i }));
    expect(compressAll).toHaveBeenCalledTimes(1);
  });
});
