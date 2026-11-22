import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageInfo } from "@/lib/pdfium/pdfium-document";
import { POINTS_PER_MM } from "./core/margins";
import { EMPTY_REPORT } from "./core/report";
import type { DocumentStatus, JobStatus } from "./document-state";

const pages: PageInfo[] = [
  { box: { left: 0, bottom: 0, right: 595, top: 842 }, rotation: 0 },
  { box: { left: 0, bottom: 0, right: 595, top: 842 }, rotation: 0 },
];

const hook = vi.hoisted(() => ({
  status: { kind: "empty" } as DocumentStatus,
  job: { kind: "idle" } as JobStatus,
  openFile: vi.fn(async () => {}),
  close: vi.fn(),
  renderPage: vi.fn(async () => ({
    status: "rendered" as const,
    width: 1,
    height: 1,
    pixels: new ArrayBuffer(4),
  })),
  crop: vi.fn(async () => {}),
  resetJob: vi.fn(),
}));
vi.mock("./use-pdf-crop", () => ({ usePdfCrop: () => hook }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import CropTool, { MAX_PDF_BYTES } from "./index";

beforeEach(() => {
  hook.status = { kind: "empty" };
  hook.job = { kind: "idle" };
  vi.clearAllMocks();
});

const ready = () => {
  hook.status = { kind: "ready", fileName: "report.pdf", pages };
};
const mm = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("CropTool", () => {
  it("offers a drop zone and opens one PDF at a time", async () => {
    render(<CropTool />);
    const input = document.querySelector('input[type="file"]')!;
    const a = new File(["x"], "a.pdf", { type: "application/pdf" });
    const b = new File(["x"], "b.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [a, b] } });
    await waitFor(() => expect(hook.openFile).toHaveBeenCalledWith(a));
    expect(toast.info).toHaveBeenCalledWith(
      "Opened a.pdf. One file at a time.",
    );
  });

  it("refuses files that are too large", async () => {
    render(<CropTool />);
    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: MAX_PDF_BYTES + 1 });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [big] },
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(hook.openFile).not.toHaveBeenCalled();
  });

  it("explains why a file could not be opened, above the drop zone", () => {
    hook.status = { kind: "failed", fileName: "x.pdf", message: "Protected." };
    render(<CropTool />);
    expect(screen.getByText("Could not open x.pdf")).toBeInTheDocument();
    expect(screen.getByText("Protected.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Choose a PDF" }),
    ).toBeInTheDocument();
  });

  it("crops every page with the typed margins, removing what is outside", async () => {
    ready();
    const user = userEvent.setup();
    render(<CropTool />);
    fireEvent.change(mm("Top"), { target: { value: "10" } });
    await user.click(screen.getByRole("button", { name: "Crop PDF" }));
    expect(hook.crop).toHaveBeenCalledTimes(1);
    const [plan] = hook.crop.mock.calls[0] as unknown as [
      {
        removeOutside: boolean;
        pages: { pageIndex: number; rect: { top: number } }[];
      },
    ];
    expect(plan.removeOutside).toBe(true);
    expect(plan.pages.map((p) => p.pageIndex)).toEqual([0, 1]);
    expect(plan.pages[0].rect.top).toBeCloseTo(842 - 10 * POINTS_PER_MM);
  });

  it("crops only the pages in a range, and explains a bad range", async () => {
    ready();
    const user = userEvent.setup();
    render(<CropTool />);
    await user.click(screen.getByLabelText("Only these pages"));
    const range = screen.getByLabelText(/Pages to crop/);
    await user.type(range, "9");
    expect(screen.getByText(/Pages go from 1 to 2/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crop PDF" }));
    expect(hook.crop).not.toHaveBeenCalled();
    await user.clear(range);
    await user.type(range, "2");
    await user.click(screen.getByRole("button", { name: "Crop PDF" }));
    const [plan] = hook.crop.mock.calls[0] as unknown as [
      { pages: { pageIndex: number }[] },
    ];
    expect(plan.pages.map((p) => p.pageIndex)).toEqual([1]);
  });

  it("refuses margins that leave nothing, and resets them", async () => {
    ready();
    const user = userEvent.setup();
    render(<CropTool />);
    fireEvent.change(mm("Left"), { target: { value: "300" } });
    expect(screen.getAllByText(/leave nothing to keep/).length).toBeGreaterThan(
      0,
    );
    await user.click(screen.getByRole("button", { name: "Crop PDF" }));
    expect(hook.crop).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reset margins" }));
    expect(mm("Left").value).toBe("0");
  });

  it("cannot crop when nothing would change", async () => {
    ready();
    const user = userEvent.setup();
    render(<CropTool />);
    await user.click(screen.getByLabelText("Remove what's outside"));
    expect(screen.getByRole("button", { name: "Crop PDF" })).toBeDisabled();
    expect(screen.getByText(/only hidden/)).toBeInTheDocument();
  });

  it("shows progress while cropping and locks the settings", () => {
    ready();
    hook.job = { kind: "working", stage: "checking", fraction: 0.5 };
    render(<CropTool />);
    expect(
      screen.getAllByText("Checking every cropped page against the original…")
        .length,
    ).toBeGreaterThan(0);
    expect(mm("Top")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Open another PDF" }),
    ).toBeDisabled();
  });

  it("shows the result, downloads it and goes back to the settings", async () => {
    ready();
    hook.job = {
      kind: "done",
      data: new ArrayBuffer(3),
      report: {
        ...EMPTY_REPORT,
        pagesCropped: 2,
        glyphsRemoved: 5,
        imagesKeptCrossing: 1,
      },
      removeOutside: true,
    };
    const user = userEvent.setup();
    render(<CropTool />);
    expect(
      screen.getByText(/removed what was outside: 5 characters/),
    ).toBeInTheDocument();
    expect(screen.getByText("Still in the file")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Download report-cropped.pdf/ }),
    );
    expect(download).toHaveBeenCalledWith(
      expect.any(Blob),
      "report-cropped.pdf",
    );
    await user.click(screen.getByRole("button", { name: "Change the crop" }));
    expect(hook.resetJob).toHaveBeenCalled();
  });

  it("explains a failed crop", () => {
    ready();
    hook.job = { kind: "failed", message: "Nope." };
    render(<CropTool />);
    expect(screen.getByText("Could not crop the PDF")).toBeInTheDocument();
    expect(screen.getAllByText(/Nope\./).length).toBeGreaterThan(0);
  });

  it("closes the file to open another", async () => {
    ready();
    const user = userEvent.setup();
    render(<CropTool />);
    await user.click(screen.getByRole("button", { name: "Open another PDF" }));
    expect(hook.close).toHaveBeenCalled();
  });
});
