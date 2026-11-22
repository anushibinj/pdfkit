import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStatus, MergeItem, MergeState } from "./merge-state";

const hook = vi.hoisted(() => ({
  state: { items: [], outcome: { kind: "idle" } } as MergeState,
  add: vi.fn(),
  submitPassword: vi.fn(),
  dismissPassword: vi.fn(),
  reopenPassword: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  merge: vi.fn(),
}));
vi.mock("./use-merge-pdfs", () => ({ useMergePdfs: () => hook }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import MergeTool, {
  LARGE_TOTAL_BYTES,
  focusMoveButton,
  outcomeAnnouncement,
  pagesLabel,
  passwordPromptFor,
  summaryText,
} from "./index";

const file = (name: string, size = 1024) => {
  const f = new File([new Uint8Array(1)], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const item = (id: string, status: FileStatus, size?: number): MergeItem => ({
  id,
  file: file(`${id}.pdf`, size),
  status,
});
const ready = (pageCount: number): FileStatus => ({ kind: "ready", pageCount });

beforeEach(() => {
  hook.state = { items: [], outcome: { kind: "idle" } };
  vi.clearAllMocks();
});

const mergeButton = () => screen.getByRole("button", { name: /Merge/ });
/** The ordered list of files (the beta notice has a list of its own). */
const fileList = () =>
  within(screen.getByRole("region", { name: "Files to merge" })).getByRole(
    "list",
  );

describe("MergeTool", () => {
  it("shows the beta notes and only the drop area before files are added", () => {
    render(<MergeTool />);
    expect(screen.getByRole("note")).toHaveTextContent(/Beta/);
    expect(screen.getByRole("note")).toHaveTextContent(/Bookmarks/);
    expect(
      screen.getByRole("button", { name: "Choose PDF files" }),
    ).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Files to merge" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Merge/ })).toBeNull();
  });

  it("adds dropped PDFs and rejects other files", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<MergeTool />);
    const input = container.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    await user.upload(input, [
      file("a.pdf"),
      new File(["x"], "notes.txt", { type: "text/plain" }),
    ]);
    expect(hook.add).toHaveBeenCalledWith([
      expect.objectContaining({ name: "a.pdf" }),
    ]);
    expect(toasts.error).toHaveBeenCalledWith(
      expect.stringMatching(/notes\.txt/),
    );
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it("warns when the files add up to a lot of memory", async () => {
    hook.state.items = [item("a", ready(1), LARGE_TOTAL_BYTES)];
    const user = userEvent.setup();
    const { container } = render(<MergeTool />);
    const input = container.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    await user.upload(input, file("b.pdf", 10));
    expect(toasts.warning).toHaveBeenCalledWith(
      expect.stringMatching(/500 MB/),
    );
    expect(hook.add).toHaveBeenCalled();
  });

  it("lists files in merge order with their status and pages", () => {
    hook.state.items = [
      item("a", ready(3)),
      item("b", { kind: "checking" }),
      item("c", { kind: "error", reason: "failed", message: "Damaged file" }),
    ];
    render(<MergeTool />);
    const rows = within(fileList()).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByTitle(/\.pdf$/).textContent)).toEqual(
      ["a.pdf", "b.pdf", "c.pdf"],
    );
    expect(rows[0]).toHaveTextContent("Ready");
    expect(rows[0]).toHaveTextContent("1 KB · 3 pages");
    expect(rows[1]).toHaveTextContent("Checking…");
    expect(rows[2]).toHaveTextContent("Cannot open");
    expect(rows[2]).toHaveTextContent("Damaged file");
  });

  it("moves and removes files, but not past either end", async () => {
    hook.state.items = [item("a", ready(1)), item("b", ready(1))];
    const user = userEvent.setup();
    render(<MergeTool />);
    expect(
      screen.getByRole("button", { name: "Move a.pdf up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move b.pdf down" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move a.pdf down" }));
    expect(hook.move).toHaveBeenCalledWith("a", 1);
    await user.click(screen.getByRole("button", { name: "Move b.pdf up" }));
    expect(hook.move).toHaveBeenCalledWith("b", -1);
    await user.click(screen.getByRole("button", { name: "Remove a.pdf" }));
    expect(hook.remove).toHaveBeenCalledWith("a");
    await user.click(screen.getByRole("button", { name: /Clear all/ }));
    expect(hook.clear).toHaveBeenCalled();
  });

  it("explains why merging is not possible yet", () => {
    hook.state.items = [item("a", ready(1))];
    render(<MergeTool />);
    expect(mergeButton()).toBeDisabled();
    expect(
      screen.getByText("Add at least two PDFs to merge."),
    ).toBeInTheDocument();
  });

  it("merges when every file is ready", async () => {
    hook.state.items = [item("a", ready(2)), item("b", ready(3))];
    const user = userEvent.setup();
    render(<MergeTool />);
    expect(screen.getByText("2 files, 5 pages, 2 KB")).toBeInTheDocument();
    await user.click(mergeButton());
    expect(hook.merge).toHaveBeenCalled();
  });

  it("locks the list and the drop area while merging", () => {
    hook.state = {
      items: [item("a", ready(1)), item("b", ready(1))],
      outcome: { kind: "merging" },
    };
    render(<MergeTool />);
    expect(screen.getByRole("button", { name: /Merging…/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Choose PDF files" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Clear all/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove a.pdf" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move a.pdf down" }),
    ).toBeDisabled();
  });

  it("downloads the merged PDF named after the first file", async () => {
    const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    hook.state = {
      items: [item("report", ready(1)), item("annex", ready(1))],
      outcome: { kind: "done", pdf, pageCount: 2, warnings: "Repaired xref" },
    };
    const user = userEvent.setup();
    render(<MergeTool />);
    expect(
      screen.getByText(/finished with a warning: Repaired xref/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Download merged PDF/ }),
    );
    expect(download).toHaveBeenCalledWith(pdf, "report-merged.pdf");
  });

  it("shows a merge error", () => {
    hook.state = {
      items: [item("a", ready(1)), item("b", ready(1))],
      outcome: { kind: "error", reason: "out-of-memory", message: "Too big" },
    };
    render(<MergeTool />);
    const alert = screen.getByText("Out of memory").closest("[role=alert]");
    expect(alert).toHaveTextContent("Too big");
  });

  it("asks for a locked file's password", async () => {
    hook.state.items = [
      item("a", ready(1)),
      item("locked", { kind: "needs-password", wrong: true, dismissed: false }),
    ];
    const user = userEvent.setup();
    render(<MergeTool />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("locked.pdf");
    expect(dialog).toHaveTextContent(/merged file will not have a password/);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /Wrong password/,
    );
    await user.type(within(dialog).getByLabelText("Password"), "hunter2");
    await user.click(within(dialog).getByRole("button", { name: "Open" }));
    expect(hook.submitPassword).toHaveBeenCalledWith("locked", "hunter2");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(hook.dismissPassword).toHaveBeenCalledWith("locked");
  });

  it("keeps the prompt open while the typed password is checked", () => {
    hook.state.items = [
      item("locked", { kind: "checking", password: "hunter2" }),
    ];
    render(<MergeTool />);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Opening…",
      }),
    ).toBeDisabled();
  });

  it("offers a skipped password prompt again", async () => {
    hook.state.items = [
      item("locked", { kind: "needs-password", wrong: false, dismissed: true }),
    ];
    const user = userEvent.setup();
    render(<MergeTool />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Enter password/ }));
    expect(hook.reopenPassword).toHaveBeenCalledWith("locked");
  });
});

describe("passwordPromptFor", () => {
  const locked = (dismissed: boolean, wrong = false): FileStatus => ({
    kind: "needs-password",
    wrong,
    dismissed,
  });

  it("prefers a file whose typed password is being checked", () => {
    const items = [
      item("a", locked(false)),
      item("b", { kind: "queued", password: "pw" }),
    ];
    expect(passwordPromptFor(items)).toEqual({
      item: items[1],
      busy: true,
      wrong: false,
    });
  });

  it("otherwise asks for the first locked file that was not skipped", () => {
    const items = [
      item("a", locked(true)),
      item("b", locked(false, true)),
      item("c", locked(false)),
    ];
    expect(passwordPromptFor(items)).toEqual({
      item: items[1],
      busy: false,
      wrong: true,
    });
  });

  it("asks nothing when no file needs a password, or all were skipped", () => {
    expect(passwordPromptFor([item("a", ready(1))])).toBeUndefined();
    expect(passwordPromptFor([item("a", locked(true))])).toBeUndefined();
    expect(
      passwordPromptFor([
        item("a", { kind: "checking", password: "x", promptSkipped: true }),
        item("b", { kind: "checking" }),
      ]),
    ).toBeUndefined();
  });
});

describe("pagesLabel", () => {
  it("uses the singular for one page", () => {
    expect(pagesLabel(1)).toBe("1 page");
    expect(pagesLabel(0)).toBe("0 pages");
    expect(pagesLabel(12)).toBe("12 pages");
  });
});

describe("summaryText", () => {
  it("describes what will be merged", () => {
    expect(summaryText({ fileCount: 3, pageCount: 7, totalBytes: 2048 })).toBe(
      "3 files, 7 pages, 2 KB",
    );
  });

  it("explains each blocker", () => {
    expect(
      summaryText({
        fileCount: 2,
        pageCount: 0,
        totalBytes: 0,
        blocker: "locked",
      }),
    ).toMatch(/password/);
    expect(
      summaryText({
        fileCount: 2,
        pageCount: 0,
        totalBytes: 0,
        blocker: "unreadable",
      }),
    ).toMatch(/Remove/);
    expect(
      summaryText({
        fileCount: 2,
        pageCount: 0,
        totalBytes: 0,
        blocker: "checking",
      }),
    ).toBe("Checking files…");
  });
});

describe("outcomeAnnouncement", () => {
  it("announces each stage of a merge", () => {
    const pdf = new Blob([new Uint8Array(2048)]);
    expect(outcomeAnnouncement({ kind: "idle" })).toBe("");
    expect(outcomeAnnouncement({ kind: "merging" })).toMatch(/Merging/);
    expect(outcomeAnnouncement({ kind: "done", pdf, pageCount: 1 })).toBe(
      "Merged PDF ready, 1 page, 2 KB.",
    );
    expect(
      outcomeAnnouncement({ kind: "error", reason: "failed", message: "Bad" }),
    ).toBe("Could not merge the PDFs. Bad");
  });
});

describe("focusMoveButton", () => {
  function list(upDisabled: boolean, downDisabled: boolean) {
    const ol = document.createElement("ol");
    ol.innerHTML = `
      <li><button data-move-id="m1" data-move-offset="-1" ${upDisabled ? "disabled" : ""}>up</button>
          <button data-move-id="m1" data-move-offset="1" ${downDisabled ? "disabled" : ""}>down</button></li>`;
    document.body.append(ol);
    return ol;
  }

  it("focuses the same direction's button on the moved row", () => {
    const ol = list(false, false);
    focusMoveButton(ol, "m1", 1);
    expect(document.activeElement?.textContent).toBe("down");
    ol.remove();
  });

  it("falls back to the other direction at the end of the list", () => {
    const ol = list(false, true);
    focusMoveButton(ol, "m1", 1);
    expect(document.activeElement?.textContent).toBe("up");
    ol.remove();
  });

  it("does nothing without a list or a usable button", () => {
    expect(() => focusMoveButton(null, "m1", 1)).not.toThrow();
    const ol = list(true, true);
    const before = document.activeElement;
    focusMoveButton(ol, "m1", -1);
    expect(document.activeElement).toBe(before);
    ol.remove();
  });
});
