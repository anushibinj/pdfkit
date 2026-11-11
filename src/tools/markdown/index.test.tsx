import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionState } from "./conversion-state";
import { DEFAULT_STYLESHEET, SAMPLE_MARKDOWN } from "./core/default-stylesheet";
import { DEFAULT_PAGE_SETUP } from "./core/page-setup";

const hook = vi.hoisted(() => ({
  state: { kind: "idle" } as ConversionState,
  convert: vi.fn(),
  cancel: vi.fn(),
  inputChanged: vi.fn(),
}));
vi.mock("./use-markdown-conversion", () => ({
  useMarkdownConversion: () => hook,
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, info: vi.fn() } }));

import MarkdownTool, { MAX_MARKDOWN_BYTES } from "./index";

beforeEach(() => {
  hook.state = { kind: "idle" };
  vi.clearAllMocks();
});

const markdownBox = () =>
  screen.getByLabelText(/^Markdown/) as HTMLTextAreaElement;
const cssBox = () => screen.getByLabelText("CSS") as HTMLTextAreaElement;

describe("MarkdownTool", () => {
  it("starts with the sample document and the default stylesheet", () => {
    render(<MarkdownTool />);
    expect(markdownBox().value).toBe(SAMPLE_MARKDOWN);
    expect(cssBox().value).toBe(DEFAULT_STYLESHEET);
    expect(screen.getByRole("note")).toHaveTextContent(/Beta/);
  });

  it("converts the current Markdown, CSS and page settings", async () => {
    const user = userEvent.setup();
    render(<MarkdownTool />);
    fireEvent.change(markdownBox(), { target: { value: "# Hi" } });
    fireEvent.change(cssBox(), { target: { value: "h1{color:red}" } });
    await user.selectOptions(screen.getByLabelText("Paper size"), "Letter");
    await user.click(screen.getByRole("button", { name: /Convert to PDF/ }));
    expect(hook.convert).toHaveBeenCalledWith({
      markdown: "# Hi",
      css: "h1{color:red}",
      page: { ...DEFAULT_PAGE_SETUP, size: "Letter" },
    });
    // every edit invalidates a previous PDF
    expect(hook.inputChanged).toHaveBeenCalledTimes(3);
  });

  it("disables conversion for empty Markdown", () => {
    render(<MarkdownTool />);
    fireEvent.change(markdownBox(), { target: { value: "   " } });
    expect(
      screen.getByRole("button", { name: /Convert to PDF/ }),
    ).toBeDisabled();
  });

  it("resets the CSS to the default", async () => {
    const user = userEvent.setup();
    render(<MarkdownTool />);
    const reset = screen.getByRole("button", { name: /Reset CSS/ });
    expect(reset).toBeDisabled();
    fireEvent.change(cssBox(), { target: { value: "p{}" } });
    await user.click(reset);
    expect(cssBox().value).toBe(DEFAULT_STYLESHEET);
  });

  it("offers Cancel while converting", async () => {
    hook.state = { kind: "converting" };
    const user = userEvent.setup();
    render(<MarkdownTool />);
    expect(screen.queryByRole("button", { name: /Convert to PDF/ })).toBeNull();
    // inputs are locked so the result matches the editors
    expect(markdownBox()).toHaveAttribute("readonly");
    expect(cssBox()).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Paper size")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reset CSS/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(hook.cancel).toHaveBeenCalled();
  });

  it("downloads the finished PDF under the opened file's name", async () => {
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    hook.state = { kind: "done", pdf };
    const user = userEvent.setup();
    const { container } = render(<MarkdownTool />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["# From file"], "notes.md", { type: "" })] },
    });
    await waitFor(() => expect(markdownBox().value).toBe("# From file"));
    expect(screen.getByLabelText("Markdown (notes.md)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    expect(download).toHaveBeenCalledWith(pdf, "notes.pdf");
  });

  it("refuses files over the size limit", async () => {
    const { container } = render(<MarkdownTool />);
    const big = new File(["x"], "big.md");
    Object.defineProperty(big, "size", { value: MAX_MARKDOWN_BYTES + 1 });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [big] },
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(markdownBox().value).toBe(SAMPLE_MARKDOWN);
  });

  it("rejects non-Markdown files", () => {
    const { container } = render(<MarkdownTool />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["x"], "photo.png", { type: "image/png" })] },
    });
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("photo.png"),
    );
  });

  it("shows conversion errors", () => {
    hook.state = { kind: "error", reason: "out-of-memory", message: "Too big" };
    render(<MarkdownTool />);
    expect(screen.getByRole("alert")).toHaveTextContent("Out of memory");
    expect(screen.getByRole("alert")).toHaveTextContent("Too big");
  });
});
