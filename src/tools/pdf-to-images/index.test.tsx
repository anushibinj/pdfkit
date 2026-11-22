import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExtractImagesResult,
  OpenResult,
  RenderPageResult,
} from "./messages";

// The worker boundary is the only fake: the real hook, reducers and
// components run on top of it.
const engine = vi.hoisted(() => ({
  open: vi.fn(),
  renderPage: vi.fn(),
  extractImages: vi.fn(),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./images-engine", () => ({
  ImagesEngine: class {
    open = engine.open;
    renderPage = engine.renderPage;
    extractImages = engine.extractImages;
    close = engine.close;
    dispose = engine.dispose;
  },
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import PdfToImagesTool, { MAX_PDF_BYTES } from "./index";

const pdf = (name = "report.pdf", size?: number) => {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};

const rendered = (pageIndex: number): RenderPageResult => ({
  status: "page",
  pageIndex,
  width: 200,
  height: 100,
  dpi: 150,
  reduced: false,
  mimeType: "image/png",
  data: new Uint8Array([1]).buffer,
});

/** Choose files through the dropzone's hidden input. */
async function choose(...files: File[]) {
  const user = userEvent.setup({ applyAccept: false });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(input, files);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  engine.open.mockResolvedValue({
    status: "opened",
    pageCount: 2,
  } satisfies OpenResult);
  engine.renderPage.mockImplementation(async (i: number) => rendered(i));
  Object.assign(URL, {
    createObjectURL: () => "blob:x",
    revokeObjectURL: vi.fn(),
  });
});

describe("PdfToImagesTool", () => {
  it("starts with a dropzone for one PDF", () => {
    render(<PdfToImagesTool />);
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Choose a PDF" }),
    ).toBeInTheDocument();
  });

  it("opens a PDF, converts its pages and downloads one", async () => {
    render(<PdfToImagesTool />);
    const user = await choose(pdf());
    expect(await screen.findByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 pages")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Convert pages" }));
    expect(await screen.findByText("report-page-01.png")).toBeInTheDocument();
    expect(engine.renderPage).toHaveBeenCalledWith(0, {
      format: "png",
      dpi: 150,
      quality: 0.9,
    });
    await user.click(
      screen.getByRole("button", { name: "Download report-page-02.png" }),
    );
    expect(download).toHaveBeenCalledWith(
      expect.any(Blob),
      "report-page-02.png",
    );
  });

  it("extracts images in images mode", async () => {
    const found: ExtractImagesResult = {
      status: "images",
      pageIndex: 0,
      entries: [
        {
          kind: "image",
          key: "k",
          width: 32,
          height: 24,
          mimeType: "image/jpeg",
          method: "original-jpeg",
          data: new Uint8Array([0xff]).buffer,
        },
      ],
    };
    engine.extractImages.mockResolvedValueOnce(found).mockResolvedValueOnce({
      status: "images",
      pageIndex: 1,
      entries: [{ kind: "repeat", key: "k" }],
    });
    render(<PdfToImagesTool />);
    const user = await choose(pdf());
    await user.click(
      await screen.findByRole("radio", { name: /Embedded images/ }),
    );
    await user.click(screen.getByRole("button", { name: "Extract images" }));
    expect(await screen.findByText("report-image-01.jpg")).toBeInTheDocument();
    expect(screen.getByText("Pages 1, 2")).toBeInTheDocument();
    expect(engine.extractImages).toHaveBeenNthCalledWith(2, 1, ["k"]);
  });

  it("asks for a password and opens with it", async () => {
    engine.open
      .mockResolvedValueOnce({ status: "password-required" })
      .mockResolvedValueOnce({ status: "opened", pageCount: 1 });
    render(<PdfToImagesTool />);
    const user = await choose(pdf("locked.pdf"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("It is used only on this device.");
    await user.type(screen.getByLabelText("Password"), "hunter2{Enter}");
    expect(await screen.findByText("1 page")).toBeInTheDocument();
    expect(engine.open).toHaveBeenLastCalledWith(
      expect.any(ArrayBuffer),
      "hunter2",
    );
  });

  it("shows why a file could not be opened, above the dropzone", async () => {
    engine.open.mockResolvedValueOnce({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
    render(<PdfToImagesTool />);
    await choose(pdf("bad.pdf"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not open bad.pdf");
    const dropzoneTitle = screen.getByText("Drop a PDF here");
    // The alert comes first in the document, so nothing sits under the dropzone.
    expect(
      alert.compareDocumentPosition(dropzoneTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("refuses non-PDFs and oversized files, and opens only the first of several", async () => {
    render(<PdfToImagesTool />);
    await choose(new File(["x"], "photo.png", { type: "image/png" }));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/photo\.png/),
    );
    await choose(pdf("huge.pdf", MAX_PDF_BYTES + 1));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/huge\.pdf is over/),
    );
    expect(engine.open).not.toHaveBeenCalled();
    await choose(pdf("one.pdf"), pdf("two.pdf"));
    expect(toast.info).toHaveBeenCalledWith(
      "Opened one.pdf. One PDF at a time.",
    );
    await waitFor(() => expect(engine.open).toHaveBeenCalledTimes(1));
  });

  it("goes back to the dropzone with Choose another PDF", async () => {
    render(<PdfToImagesTool />);
    const user = await choose(pdf());
    await user.click(
      await screen.findByRole("button", { name: "Choose another PDF" }),
    );
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
    expect(engine.close).toHaveBeenCalled();
  });
});
