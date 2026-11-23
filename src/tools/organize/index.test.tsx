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

// The worker boundary is the only fake: the real hook, reducer, queue and
// components run on top of it.
const engine = vi.hoisted(() => ({
  open: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./organize-engine", () => ({
  OrganizeEngine: class {
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

import OrganizeTool from "./index";

const portrait = {
  box: { left: 0, bottom: 0, right: 600, top: 800 },
  rotation: 0 as const,
};
const opened = (pages = 2): OpenResult => ({
  status: "opened",
  pages: Array(pages).fill(portrait),
});
const pdf = (name: string) =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  engine.open.mockResolvedValue(opened());
  engine.render.mockReturnValue(new Promise(() => {})); // thumbnails stay "loading"
  engine.save.mockResolvedValue({
    status: "saved",
    data: new ArrayBuffer(4),
  } satisfies SaveResult);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

/** Pick files in the dropzone's (hidden) input. */
function pickFiles(...files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
}
const options = () => screen.getAllByRole("option");
const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** Render the tool and open two files of 2 and 1 pages. */
async function openTwo() {
  engine.open.mockResolvedValueOnce(opened(2)).mockResolvedValueOnce(opened(1));
  render(<OrganizeTool />);
  pickFiles(pdf("a.pdf"), pdf("b.pdf"));
  await waitFor(() => expect(options()).toHaveLength(3));
}

describe("OrganizeTool", () => {
  it("starts with the beta notice and the dropzone only", () => {
    render(<OrganizeTool />);
    expect(screen.getByRole("note")).toHaveTextContent("Beta");
    expect(button("Choose PDFs")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("puts the pages of several files on one board, numbered by file", async () => {
    await openTwo();
    expect(options().map((o) => o.getAttribute("aria-label"))).toEqual([
      "Page 1: a.pdf, page 1",
      "Page 2: a.pdf, page 2",
      "Page 3: b.pdf, page 1",
    ]);
    const files = within(screen.getByRole("list", { name: "Files" }));
    expect(files.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Choose PDFs")).toBeNull();
  });

  it("rejects non-PDF files with a message", () => {
    render(<OrganizeTool />);
    pickFiles(new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(toast.error).toHaveBeenCalledWith(
      "Only PDF files are supported. Skipped: notes.txt",
    );
    expect(engine.open).not.toHaveBeenCalled();
  });

  it("rotates, deletes and undoes through the toolbar, announcing each", async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(options()[0]);
    await user.click(button("Rotate right"));
    expect(options()[0]).toHaveAccessibleName(
      "Page 1: a.pdf, page 1, turned 90°",
    );
    expect(screen.getByText("Turned 1 page right.")).toBeInTheDocument();
    await user.click(button("Delete"));
    expect(options()).toHaveLength(2);
    await user.click(button("Undo"));
    expect(options()).toHaveLength(3);
    expect(screen.getByText("Undone.")).toBeInTheDocument();
  });

  it("supports the window shortcuts for undo and delete", async () => {
    await openTwo();
    fireEvent.click(options()[1]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(options()).toHaveLength(2);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(options()).toHaveLength(3);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(options()).toHaveLength(2);
  });

  it("interleaves all pages when fewer than two are selected", async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(button("Interleave all"));
    expect(options().map((o) => o.getAttribute("aria-label"))).toEqual([
      "Page 1: a.pdf, page 1",
      "Page 2: b.pdf, page 1",
      "Page 3: a.pdf, page 2",
    ]);
  });

  it("downloads the board as one PDF named for combined files", async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(options()[2]);
    await user.click(button("Move earlier"));
    await user.click(button("Download PDF"));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(engine.save).toHaveBeenCalledWith([
      { kind: "source", sourceId: "s1", pageIndex: 0, rotation: 0 },
      { kind: "source", sourceId: "s2", pageIndex: 0, rotation: 0 },
      { kind: "source", sourceId: "s1", pageIndex: 1, rotation: 0 },
    ]);
    expect(download.mock.calls[0][1]).toBe("organized.pdf");
  });

  it("names a single file's result after it, and reports save errors", async () => {
    const user = userEvent.setup();
    engine.open.mockResolvedValueOnce(opened(2));
    render(<OrganizeTool />);
    pickFiles(pdf("report.pdf"));
    await waitFor(() => expect(options()).toHaveLength(2));
    await user.click(button("Download PDF"));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0][1]).toBe("report-organized.pdf");
    engine.save.mockResolvedValueOnce({
      status: "error",
      reason: "failed",
      message: "Disk on fire.",
    });
    await user.click(button("Download PDF"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Disk on fire."),
    );
  });

  it("asks for a password, says the output has none, and can skip the file", async () => {
    const user = userEvent.setup();
    engine.open.mockResolvedValueOnce({ status: "password-required" });
    render(<OrganizeTool />);
    pickFiles(pdf("locked.pdf"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("saved without a password");
    await user.click(
      within(dialog).getByRole("button", { name: "Skip this file" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(button("Choose PDFs")).toBeInTheDocument();
  });

  it("opens a protected file with its password and marks it in the legend", async () => {
    const user = userEvent.setup();
    engine.open
      .mockResolvedValueOnce({ status: "password-required" })
      .mockResolvedValueOnce(opened(1));
    render(<OrganizeTool />);
    pickFiles(pdf("locked.pdf"));
    await user.type(await screen.findByLabelText("Password"), "hunter2{Enter}");
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(engine.open).toHaveBeenLastCalledWith(
      "s1",
      expect.any(ArrayBuffer),
      "hunter2",
    );
    expect(screen.getByRole("list", { name: "Files" })).toHaveTextContent(
      "opened with a password",
    );
  });

  it("confirms before starting over with changes, then shows the dropzone", async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(button("Start over"));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Start over" }),
    );
    expect(engine.close).toHaveBeenCalledWith();
    expect(button("Choose PDFs")).toBeInTheDocument();
  });

  it("keeps the board up when undo empties it, so redo is reachable", async () => {
    const user = userEvent.setup();
    engine.open.mockResolvedValueOnce(opened(1));
    render(<OrganizeTool />);
    pickFiles(pdf("a.pdf"));
    await waitFor(() => expect(options()).toHaveLength(1));
    await user.click(button("Undo"));
    expect(
      screen.getByText("The board is empty. Undo, or add PDFs."),
    ).toBeVisible();
    await user.click(button("Redo"));
    expect(options()).toHaveLength(1);
  });

  it("adds files dropped on the board", async () => {
    await openTwo();
    engine.open.mockResolvedValueOnce(opened(1));
    const board = screen.getByRole("region", { name: "Page board" });
    await act(async () => {
      fireEvent.drop(board, {
        dataTransfer: { files: [pdf("c.pdf")], types: ["Files"] },
      });
    });
    await waitFor(() => expect(options()).toHaveLength(4));
  });

  it("shows the selection count and the select-all/none links", async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(button("Select all"));
    expect(screen.getByText("3 of 3 pages selected")).toBeInTheDocument();
    await user.click(button("Select none"));
    expect(screen.getByText("3 pages")).toBeInTheDocument();
  });
});
