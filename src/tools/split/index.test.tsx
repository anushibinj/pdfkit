import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssembleResult, OpenResult } from "./messages";

// The worker boundary is the only fake: the real hooks, reducers and
// components run on top of it.
const preview = vi.hoisted(() => ({
  open: vi.fn(),
  render: vi.fn(),
  close: vi.fn(async () => ({ status: "closed" })),
  dispose: vi.fn(),
}));
vi.mock("./preview-engine", () => ({
  PreviewEngine: class {
    open = preview.open;
    render = preview.render;
    close = preview.close;
    dispose = preview.dispose;
  },
}));
const assembly = vi.hoisted(() => ({
  assemble: vi.fn(),
  cancel: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./assembly-service", async (original) => ({
  ...(await original<typeof import("./assembly-service")>()),
  AssemblyService: class {
    assemble = assembly.assemble;
    cancel = assembly.cancel;
    dispose = assembly.dispose;
  },
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import SplitTool, { MAX_PDF_BYTES } from "./index";

const opened = (pages = 3): OpenResult => ({
  status: "opened",
  pages: Array.from({ length: pages }, () => ({ width: 600, height: 800 })),
});

/** Answer each build with one small file per requested output. */
const assembledFor = (outputs: number[][]): AssembleResult => ({
  status: "assembled",
  files: outputs.map((_, i) => ({ data: new ArrayBuffer(i + 1), crc32: i })),
});

const pdf = (name = "doc.pdf") =>
  new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  preview.open.mockResolvedValue(opened());
  preview.render.mockReturnValue(new Promise(() => {})); // thumbnails stay "loading"
  assembly.assemble.mockImplementation(
    async (_data: ArrayBuffer, _pw: string, _count: number, outputs: number[][]) =>
      assembledFor(outputs),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

/** Render the tool and open a PDF through the file picker. */
async function openPdf(file = pdf()) {
  const user = userEvent.setup();
  const view = render(<SplitTool />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(input, file);
  await screen.findByRole("group", { name: "What to do" });
  return { user, ...view };
}

describe("SplitTool", () => {
  it("starts with only the drop area", () => {
    render(<SplitTool />);
    expect(screen.getByRole("button", { name: "Choose a PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "What to do" })).toBeNull();
  });

  it("opens a PDF and shows its pages", async () => {
    await openPdf();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.getByText(/3 pages/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Pages" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText("File 1")).toHaveLength(1);
    expect(screen.getByText("File 3")).toBeInTheDocument();
  });

  it("refuses files over the size limit", async () => {
    const user = userEvent.setup();
    const { container } = render(<SplitTool />);
    const big = pdf("big.pdf");
    Object.defineProperty(big, "size", { value: MAX_PDF_BYTES + 1 });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, big);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/too large/));
    expect(preview.open).not.toHaveBeenCalled();
  });

  it("asks for the password and says the new files keep it", async () => {
    preview.open.mockResolvedValueOnce({ status: "password-required" });
    const user = userEvent.setup();
    const { container } = render(<SplitTool />);
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, pdf());
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("The new files keep the same password.");
    await user.type(within(dialog).getByLabelText("Password"), "hunter2");
    await user.click(within(dialog).getByRole("button", { name: "Open" }));
    await screen.findByRole("group", { name: "What to do" });
    expect(preview.open).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), "hunter2");
    expect(screen.getByText("The new files keep the same password.")).toBeInTheDocument();
  });

  it("splits every page and downloads all files as one ZIP", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("button", { name: "Split into 3 files" }));
    await screen.findByText("3 files are ready");
    expect(assembly.assemble).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "",
      3,
      [[0], [1], [2]],
      expect.any(Function),
    );
    expect(screen.getByText("doc-page-1.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download all (.zip)" }));
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "doc-split.zip");
    expect((download.mock.calls[0][0] as Blob).type).toBe("application/zip");
    await user.click(screen.getByRole("button", { name: "Download doc-page-2.pdf" }));
    expect(download).toHaveBeenLastCalledWith(expect.any(Blob), "doc-page-2.pdf");
  });

  it("splits by typed ranges and explains mistakes", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("radio", { name: "Custom ranges, one file each" }));
    const ranges = screen.getByLabelText("Ranges, one file each");
    await user.type(ranges, "1-2, 9");
    expect(ranges).toHaveAccessibleDescription(/only 3 pages/);
    expect(screen.getByRole("button", { name: "Split PDF" })).toBeDisabled();
    await user.clear(ranges);
    await user.type(ranges, "1-2, 3");
    await user.click(screen.getByRole("button", { name: "Split into 2 files" }));
    await screen.findByText("2 files are ready");
    expect(assembly.assemble.mock.calls[0][3]).toEqual([[0, 1], [2]]);
  });

  it("extracts the pages clicked on the thumbnails", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("radio", { name: "Extract pages" }));
    expect(screen.getByRole("button", { name: "Extract pages" })).toBeDisabled();
    expect(screen.getByText("Pick at least one page to extract.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Page 3" }));
    await user.click(screen.getByRole("button", { name: "Page 1" }));
    expect(screen.getByLabelText("Pages to extract")).toHaveValue("1, 3");
    await user.click(screen.getByRole("button", { name: "Extract 2 pages" }));
    await screen.findByText("Your file is ready");
    expect(assembly.assemble.mock.calls[0][3]).toEqual([[0, 2]]);
    await user.click(screen.getByRole("button", { name: "Download doc-extracted.pdf" }));
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "doc-extracted.pdf");
  });

  it("removes typed pages and refuses to remove them all", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("radio", { name: "Remove pages" }));
    const field = screen.getByLabelText("Pages to remove");
    await user.type(field, "1-3");
    expect(screen.getByText(/needs at least one page/)).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "2");
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Remove 1 page" }));
    await screen.findByText("Your file is ready");
    expect(assembly.assemble.mock.calls[0][3]).toEqual([[0, 2]]);
    expect(screen.getByText("doc-pages-removed.pdf")).toBeInTheDocument();
  });

  it("hides results once the settings change", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("button", { name: "Split into 3 files" }));
    await screen.findByText("3 files are ready");
    await user.clear(screen.getByLabelText("Pages per file"));
    await user.type(screen.getByLabelText("Pages per file"), "2");
    expect(screen.queryByText("3 files are ready")).toBeNull();
    expect(screen.getByRole("button", { name: "Split into 2 files" })).toBeEnabled();
  });

  it("shows a failure and can cancel a long build", async () => {
    let finish: (r: AssembleResult) => void = () => {};
    assembly.assemble.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const { user } = await openPdf();
    await user.click(screen.getByRole("button", { name: "Split into 3 files" }));
    expect(screen.getByRole("radio", { name: "Remove pages" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(assembly.cancel).toHaveBeenCalled();
    await act(async () => finish({ status: "error", reason: "failed", message: "late" }));
    expect(screen.queryByText("late")).toBeNull();

    assembly.assemble.mockResolvedValueOnce({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file.",
    });
    await user.click(screen.getByRole("button", { name: "Split into 3 files" }));
    expect(await screen.findByText("Could not make the files")).toBeInTheDocument();
    expect(screen.getByText("This does not look like a valid PDF file.")).toBeInTheDocument();
  });

  it("opens another PDF from scratch", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("radio", { name: "Extract pages" }));
    await user.click(screen.getByRole("button", { name: "Open another PDF" }));
    expect(preview.close).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Choose a PDF" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("group", { name: "What to do" })).toBeNull());
  });

  it("shows why a file could not be opened", async () => {
    preview.open.mockResolvedValueOnce({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
    const user = userEvent.setup();
    const { container } = render(<SplitTool />);
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, pdf("bad.pdf"));
    expect(await screen.findByText("Could not open bad.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a PDF" })).toBeInTheDocument();
  });
});
