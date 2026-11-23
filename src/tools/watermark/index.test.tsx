import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePng } from "@/lib/test-utils/images";
import { DEFAULT_SETTINGS } from "./core/model";
import type { ApplyResult, OpenResult } from "./messages";

// The worker boundary is the only fake: the real hook, reducers and
// components run on top of it.
const engine = vi.hoisted(() => ({
  open: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./watermark-engine", () => ({
  WatermarkEngine: class {
    open = engine.open;
    preview = engine.preview;
    apply = engine.apply;
    close = engine.close;
    dispose = engine.dispose;
  },
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import WatermarkTool, { MAX_PDF_BYTES } from "./index";

const pdf = (name = "report.pdf", size?: number) => {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};

beforeEach(() => {
  vi.clearAllMocks();
  engine.open.mockResolvedValue({
    status: "opened",
    pageCount: 3,
  } satisfies OpenResult);
  engine.preview.mockReturnValue(new Promise(() => {})); // stays "rendering"
  engine.apply.mockResolvedValue({
    status: "watermarked",
    data: new ArrayBuffer(4),
  } satisfies ApplyResult);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

/** Render the tool and open a PDF through the file input. */
async function openPdf(file = pdf()) {
  const user = userEvent.setup();
  const view = render(<WatermarkTool />);
  const input = view.container.querySelector<HTMLInputElement>(
    'input[type="file"][accept=".pdf,application/pdf"]',
  )!;
  await user.upload(input, file);
  await screen.findByRole("button", { name: /Download PDF/ });
  return { user, ...view };
}

describe("WatermarkTool", () => {
  it("starts with a drop area, without extra text under it", () => {
    render(<WatermarkTool />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
    // the drop area's own hint is the only text below it (CLAUDE.md)
    expect(
      screen.getByText("Files stay on your device. Nothing is uploaded."),
    ).toBeInTheDocument();
  });

  it("opens a PDF and shows its name, the settings and a preview", async () => {
    await openPdf();
    expect(engine.open).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Watermark text")).toHaveValue("CONFIDENTIAL");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("downloads the watermarked PDF with the default settings on every page", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(engine.apply).toHaveBeenCalledWith(DEFAULT_SETTINGS, [0, 1, 2]);
    expect(download.mock.calls[0][1]).toBe("report-watermarked.pdf");
    expect(
      screen.getByText("Saved report-watermarked.pdf."),
    ).toBeInTheDocument();
  });

  it("watermarks only the pages typed in the page range", async () => {
    const { user } = await openPdf();
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "2-3" },
    });
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(engine.apply).toHaveBeenCalled());
    expect(engine.apply.mock.calls[0][1]).toEqual([1, 2]);
  });

  it("blocks the download while the text cannot be written, and says why", async () => {
    await openPdf();
    fireEvent.change(screen.getByLabelText("Watermark text"), {
      target: { value: "Price ₹5" },
    });
    const button = screen.getByRole("button", { name: /Download PDF/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/standard PDF fonts: ₹/);
  });

  it("reports a failed download", async () => {
    engine.apply.mockResolvedValue({
      status: "error",
      reason: "failed",
      message: "qpdf could not process this file.",
    } satisfies ApplyResult);
    const { user } = await openPdf();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "qpdf could not process this file.",
      ),
    );
    expect(download).not.toHaveBeenCalled();
  });

  it("asks for a password and keeps the file protected", async () => {
    engine.open
      .mockResolvedValueOnce({ status: "password-required" })
      .mockResolvedValueOnce({ status: "opened", pageCount: 1 });
    const user = userEvent.setup();
    const view = render(<WatermarkTool />);
    await user.upload(
      view.container.querySelector<HTMLInputElement>('input[type="file"]')!,
      pdf("locked.pdf"),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "The watermarked file keeps the same password.",
    );
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("button", { name: /Download PDF/ });
    expect(engine.open).toHaveBeenLastCalledWith(
      expect.any(ArrayBuffer),
      "hunter2",
    );
  });

  it("refuses files that are not PDFs or are too large", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const view = render(<WatermarkTool />);
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(
      input,
      new File(["x"], "notes.txt", { type: "text/plain" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/Only PDF files/),
    );
    await user.upload(input, pdf("huge.pdf", MAX_PDF_BYTES + 1));
    expect(toast.error).toHaveBeenLastCalledWith(
      expect.stringMatching(/too large/),
    );
    expect(engine.open).not.toHaveBeenCalled();
  });

  it("uses a picked PNG as a picture watermark, and refuses other files", async () => {
    const { user, container } = await openPdf();
    await user.click(screen.getByRole("radio", { name: "Picture" }));
    const imageInput = () =>
      container.querySelector<HTMLInputElement>(
        'input[type="file"][accept^="image"]',
      )!;
    const png = makePng(2, 2, () => [0, 0, 255, 255]);
    await user.upload(
      imageInput(),
      new File([png as BlobPart], "logo.png", { type: "image/png" }),
    );
    await screen.findByRole("button", { name: "Choose another picture" });
    expect(screen.getByText("logo.png")).toBeInTheDocument();

    const fakeUser = userEvent.setup({ applyAccept: false });
    await fakeUser.upload(
      imageInput(),
      new File(["GIF89a"], "anim.gif", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "anim.gif is not a PNG or JPEG image.",
      ),
    );
  });

  it("refuses a picture the browser cannot decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new DOMException("The source image could not be decoded.");
      }),
    );
    const { user, container } = await openPdf();
    await user.click(screen.getByRole("radio", { name: "Picture" }));
    const png = makePng(2, 2, () => [0, 0, 255, 255]);
    await user.upload(
      container.querySelector<HTMLInputElement>(
        'input[type="file"][accept^="image"]',
      )!,
      new File([png as BlobPart], "broken.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "broken.png could not be read. It may be damaged.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Choose a picture" }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("goes back to the drop area with Open another", async () => {
    const { user } = await openPdf();
    await user.click(screen.getByRole("button", { name: /Open another/ }));
    expect(engine.close).toHaveBeenCalled();
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
  });

  it("disposes the engine when the page is left", async () => {
    const { unmount } = await openPdf();
    act(() => unmount());
    expect(engine.dispose).toHaveBeenCalled();
  });
});
