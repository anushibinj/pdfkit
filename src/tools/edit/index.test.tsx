import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenResult, SaveResult } from "./messages";
import { makePng } from "./test-utils/images";

// The worker boundary is the only fake: the real hook, reducers and
// components run on top of it.
const engine = vi.hoisted(() => ({
  open: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./editor-engine", () => ({
  EditorEngine: class {
    open = engine.open;
    render = engine.render;
    save = engine.save;
    close = engine.close;
    dispose = engine.dispose;
  },
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import EditTool, { MAX_PDF_BYTES } from "./index";

const page = {
  box: { left: 0, bottom: 0, right: 600, top: 400 },
  rotation: 0 as const,
};
const opened = (pages = 2): OpenResult => ({
  status: "opened",
  pages: Array(pages).fill(page),
});

beforeEach(() => {
  vi.clearAllMocks();
  engine.open.mockResolvedValue(opened());
  engine.render.mockReturnValue(new Promise(() => {})); // pages stay "loading"
  engine.save.mockResolvedValue({
    status: "saved",
    data: new ArrayBuffer(4),
  } satisfies SaveResult);
  Object.assign(URL, {
    createObjectURL: () => "blob:img",
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => vi.restoreAllMocks());

const fileInput = (c: HTMLElement) =>
  c.querySelector(
    'input[type="file"][accept=".pdf,application/pdf"]',
  ) as HTMLInputElement;
const pick = (input: HTMLInputElement, file: File) =>
  fireEvent.change(input, { target: { files: [file] } });
const pdf = (name = "report.pdf") =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });
const at = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
});

async function openDocument(pages = 2) {
  engine.open.mockResolvedValue(opened(pages));
  const user = userEvent.setup();
  const utils = render(<EditTool />);
  pick(fileInput(utils.container), pdf());
  await screen.findByRole("toolbar", { name: "Editing tools" });
  return { ...utils, user };
}

describe("EditTool", () => {
  it("starts with the beta note and a PDF drop area", () => {
    const { container } = render(<EditTool />);
    expect(screen.getByRole("note")).toHaveTextContent(/Beta/);
    expect(screen.getByRole("note")).toHaveTextContent(/White-out deletes/);
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
    expect(fileInput(container)).not.toBeNull();
  });

  it("rejects other files and files that are too large", () => {
    const { container } = render(<EditTool />);
    pick(
      fileInput(container),
      new File(["x"], "photo.png", { type: "image/png" }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("photo.png"),
    );
    const big = pdf("big.pdf");
    Object.defineProperty(big, "size", { value: MAX_PDF_BYTES + 1 });
    pick(fileInput(container), big);
    expect(toast.error).toHaveBeenLastCalledWith(
      expect.stringContaining("too large"),
    );
    expect(engine.open).not.toHaveBeenCalled();
  });

  it("opens a PDF and shows its pages under the editing toolbar", async () => {
    await openDocument(2);
    expect(engine.open).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    expect(
      screen.getByRole("region", { name: "Page 1 of 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Page 2 of 2" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Drop a PDF here")).toBeNull();
    expect(engine.render).toHaveBeenCalledWith(
      0,
      0,
      expect.any(Number),
      expect.any(AbortSignal),
    );
  });

  it("asks for a password and opens the file with it", async () => {
    engine.open
      .mockResolvedValueOnce({ status: "password-required" })
      .mockResolvedValueOnce(opened(1));
    const user = userEvent.setup();
    const { container } = render(<EditTool />);
    pick(fileInput(container), pdf("locked.pdf"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("locked.pdf");
    await user.type(within(dialog).getByLabelText("Password"), "hunter2");
    await user.click(within(dialog).getByRole("button", { name: "Open" }));
    await screen.findByRole("toolbar", { name: "Editing tools" });
    expect(engine.open).toHaveBeenLastCalledWith(
      expect.any(ArrayBuffer),
      "hunter2",
    );
  });

  it("explains files that cannot be opened and offers the drop area again", async () => {
    engine.open.mockResolvedValue({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file.",
    });
    const { container } = render(<EditTool />);
    pick(fileInput(container), pdf("junk.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not open junk.pdf",
    );
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
  });

  it("adds text with the Text tool and edits it in the panel", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.pointerDown(
      screen.getByLabelText("Page 1 editing area"),
      at(50, 60),
    );
    const field = await screen.findByLabelText("Text content");
    expect(field).toHaveValue("Text");
    expect(field).toHaveFocus();
    // back to the select tool, with the new text selected
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(field, { target: { value: "Signed by Ask" } });
    expect(screen.getByLabelText("Page 1 editing area")).toHaveTextContent(
      "Signed by Ask",
    );
  });

  it("keeps a drawing tool active and shows its style after each box", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "White-out" }));
    const overlay = screen.getByLabelText("Page 1 editing area");
    fireEvent.pointerDown(overlay, at(10, 10));
    fireEvent.pointerUp(overlay, at(110, 40));
    fireEvent.pointerDown(overlay, at(10, 100));
    fireEvent.pointerUp(overlay, at(110, 140));
    expect(screen.getByRole("button", { name: "White-out" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(overlay.querySelectorAll("[data-preview-only]")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Delete$/ })).toBeNull();
  });

  it("deletes the selection with the keyboard and undoes it", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Text" }));
    const overlay = screen.getByLabelText("Page 1 editing area");
    fireEvent.pointerDown(overlay, at(50, 60));
    await screen.findByLabelText("Text content");
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(window, { key: "Delete" });
    expect(overlay.querySelector("text")).toBeNull();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(overlay.querySelector("text")).not.toBeNull();
  });

  it("nudges the selected object with the arrow keys and deselects with Escape", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Box" }));
    const overlay = screen.getByLabelText("Page 1 editing area");
    fireEvent.pointerDown(overlay, at(10, 10));
    fireEvent.pointerUp(overlay, at(60, 40));
    await user.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.focus(overlay.querySelector('[role="button"]')!);
    const before = overlay
      .querySelector('[role="button"]')!
      .getAttribute("transform");
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(
      overlay.querySelector('[role="button"]')!.getAttribute("transform"),
    ).not.toBe(before);
    expect(
      screen.getByRole("button", { name: /^Delete$/ }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /^Delete$/ })).toBeNull();
  });

  it("rotates, reorders and deletes pages", async () => {
    const { user } = await openDocument(2);
    await user.click(
      screen.getByRole("button", { name: "Rotate page 1 right" }),
    );
    expect(
      screen.getByLabelText("Page 1 editing area").getAttribute("viewBox"),
    ).toBe("0 0 400 600");
    await user.click(screen.getByRole("button", { name: "Move page 1 down" }));
    expect(
      screen.getByLabelText("Page 2 editing area").getAttribute("viewBox"),
    ).toBe("0 0 400 600");
    await user.click(screen.getByRole("button", { name: "Delete page 1" }));
    expect(
      screen.getByRole("region", { name: "Page 1 of 1" }),
    ).toBeInTheDocument();
  });

  it("places a picked image with the next click", async () => {
    const { container } = await openDocument(1);
    const imageInput = container.querySelector(
      '[data-testid="image-input"]',
    ) as HTMLInputElement;
    pick(
      imageInput,
      new File([makePng(20, 10, () => [0, 0, 0, 255]) as BlobPart], "sig.png", {
        type: "image/png",
      }),
    );
    expect(
      await screen.findByText(/Click on a page to place/),
    ).toHaveTextContent("sig.png");
    fireEvent.pointerDown(
      screen.getByLabelText("Page 1 editing area"),
      at(20, 20),
    );
    const image = screen
      .getByLabelText("Page 1 editing area")
      .querySelector("image")!;
    expect(image.getAttribute("href")).toBe("blob:img");
    expect(image.getAttribute("width")).toBe("240"); // 40% of 600 pt
    expect(image.getAttribute("height")).toBe("120");
    expect(screen.queryByText(/Click on a page to place/)).toBeNull();
  });

  it("refuses images that are not PNG or JPEG", async () => {
    const { container } = await openDocument(1);
    const imageInput = container.querySelector(
      '[data-testid="image-input"]',
    ) as HTMLInputElement;
    pick(
      imageInput,
      new File(["GIF89a......"], "anim.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "anim.png is not a PNG or JPEG image.",
      ),
    );
  });

  it("downloads the edited file as <name>-edited.pdf", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    const [blob, name] = download.mock.calls[0];
    expect(name).toBe("report-edited.pdf");
    expect((blob as Blob).type).toBe("application/pdf");
    const plan = engine.save.mock.calls[0][0];
    expect(plan.pages).toEqual([{ sourceIndex: 0, rotation: 0, objects: [] }]);
  });

  it("reports a failed save", async () => {
    engine.save.mockResolvedValue({
      status: "error",
      reason: "out-of-memory",
      message: "Out of memory.",
    });
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Out of memory."),
    );
    expect(download).not.toHaveBeenCalled();
  });

  it("asks before discarding edits that were not downloaded", async () => {
    const { user } = await openDocument(1);
    await user.click(
      screen.getByRole("button", { name: "Rotate page 1 right" }),
    );
    await user.click(screen.getByRole("button", { name: /Open another/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(
      screen.getByRole("toolbar", { name: "Editing tools" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open another/ }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Discard edits",
      }),
    );
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
    expect(engine.close).toHaveBeenCalled();
  });

  it("closes without asking once the edits were downloaded", async () => {
    const { user } = await openDocument(1);
    await user.click(
      screen.getByRole("button", { name: "Rotate page 1 right" }),
    );
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Open another/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Drop a PDF here")).toBeInTheDocument();
  });
});
