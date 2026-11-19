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
import type { TextRun } from "./core/text-runs";
import type { OpenResult, RenderResult, SaveResult } from "./messages";
import { makePng } from "./test-utils/images";

// The worker boundary is the only fake: the real hook, reducers and
// components run on top of it.
const engine = vi.hoisted(() => ({
  open: vi.fn(),
  render: vi.fn(),
  textRuns: vi.fn(),
  save: vi.fn(),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./editor-engine", () => ({
  EditorEngine: class {
    open = engine.open;
    render = engine.render;
    textRuns = engine.textRuns;
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
/** One line of the file's own text, at view (50, 50) to (150, 60). */
const line: TextRun = {
  id: "0-1",
  indices: [0, 1],
  text: "Total 1250",
  box: { left: 50, bottom: 340, right: 150, top: 350 },
  baseline: [1, 0, 0, 1, 50, 342],
  width: 100,
  fontSize: 10,
  style: { family: "sans", bold: false, italic: false },
  color: { r: 0, g: 0, b: 0 },
};
const opened = (pages = 2): OpenResult => ({
  status: "opened",
  pages: Array(pages).fill(page),
});

beforeEach(() => {
  vi.clearAllMocks();
  engine.open.mockResolvedValue(opened());
  engine.render.mockReturnValue(new Promise(() => {})); // pages stay "loading"
  engine.textRuns.mockResolvedValue({ status: "text-runs", runs: [line] });
  // jsdom has no canvas; say so quietly instead of logging an error
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
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
    expect(screen.getByRole("note")).toHaveTextContent(
      /Change the PDF's own text in place with Edit text/,
    );
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
    expect(engine.render).toHaveBeenCalledWith(0, 0, expect.any(Number), {
      signal: expect.any(AbortSignal),
      textEdits: [],
    });
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

  it("adds text with the Add text tool and types it on the page", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const overlay = screen.getByLabelText("Page 1 editing area");
    fireEvent.pointerDown(overlay, at(50, 60));
    const field = await screen.findByRole("textbox", {
      name: "Text on the page",
    });
    expect(field).toHaveValue("Text");
    expect(field).toHaveFocus();
    // back to the select tool, with the new text selected
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(field, { target: { value: "Signed by Ask" } });
    // the panel shows the same text
    expect(screen.getByLabelText("Text content")).toHaveValue("Signed by Ask");
    act(() => field.blur());
    expect(
      screen.queryByRole("textbox", { name: "Text on the page" }),
    ).toBeNull();
    expect(overlay).toHaveTextContent("Signed by Ask");
  });

  it("drops new text that was left empty", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const overlay = screen.getByLabelText("Page 1 editing area");
    fireEvent.pointerDown(overlay, at(50, 60));
    const field = await screen.findByRole("textbox", {
      name: "Text on the page",
    });
    fireEvent.change(field, { target: { value: "  " } });
    act(() => field.blur());
    expect(overlay.querySelector("[data-object-id]")).toBeNull();
  });

  it("changes the PDF's own text in place with Edit text", async () => {
    const outcome = {
      runId: "0-1",
      applied: true,
      written: "Total Zed",
      substituteFont: "Helvetica",
    };
    engine.render.mockImplementation(
      async (
        _i: number,
        _r: number,
        _w: number,
        o: { textEdits: { runId: string; text: string }[] },
      ): Promise<RenderResult> => ({
        status: "rendered",
        width: 1,
        height: 1,
        pixels: new ArrayBuffer(4),
        textOutcomes: o.textEdits.some((e) => e.text === "Total Zed")
          ? [outcome]
          : [],
      }),
    );
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Edit text" }));
    expect(engine.textRuns).toHaveBeenCalledWith(0);
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Edit text: Total 1250" }),
      at(60, 55),
    );
    const field = await screen.findByRole("textbox", {
      name: "Edit text: Total 1250",
    });
    // while typing, the page is rendered without the line
    expect(engine.render).toHaveBeenLastCalledWith(0, 0, expect.any(Number), {
      signal: expect.any(AbortSignal),
      textEdits: [{ runId: "0-1", text: "" }],
    });
    fireEvent.change(field, { target: { value: "Total Zed" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(engine.render).toHaveBeenLastCalledWith(0, 0, expect.any(Number), {
        signal: expect.any(AbortSignal),
        textEdits: [{ runId: "0-1", text: "Total Zed" }],
      }),
    );
    // the substitute font is explained once
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining("is written in Helvetica"),
      ),
    );
    // undo restores the original line
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(engine.render).toHaveBeenLastCalledWith(0, 0, expect.any(Number), {
        signal: expect.any(AbortSignal),
        textEdits: [],
      }),
    );
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(engine.save).toHaveBeenCalled());
    expect(engine.save.mock.calls[0][0].pages[0].textEdits).toEqual([
      { runId: "0-1", text: "Total Zed" },
    ]);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("keeps a drawing tool active and shows its style after each box", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Highlight" }));
    const overlay = screen.getByLabelText("Page 1 editing area");
    fireEvent.pointerDown(overlay, at(10, 10));
    fireEvent.pointerUp(overlay, at(110, 40));
    fireEvent.pointerDown(overlay, at(10, 100));
    fireEvent.pointerUp(overlay, at(110, 140));
    expect(screen.getByRole("button", { name: "Highlight" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(overlay.querySelectorAll("rect[fill-opacity]")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Delete$/ })).toBeNull();
  });

  it("deletes the selection with the keyboard and undoes it", async () => {
    const { user } = await openDocument(1);
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const overlay = screen.getByLabelText("Page 1 editing area");
    fireEvent.pointerDown(overlay, at(50, 60));
    await screen.findByLabelText("Text on the page");
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
    expect(plan.pages).toEqual([
      { sourceIndex: 0, rotation: 0, objects: [], textEdits: [] },
    ]);
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
