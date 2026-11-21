import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionState } from "@/lib/html-pdf/conversion-state";
import { DEFAULT_PAGE_SETUP } from "@/lib/html-pdf/page-setup";
import { SAMPLE_HTML } from "./core/sample-html";

const hook = vi.hoisted(() => ({
  state: { kind: "idle" } as ConversionState,
  convert: vi.fn(),
  cancel: vi.fn(),
  inputChanged: vi.fn(),
}));
vi.mock("./use-html-conversion", () => ({
  useHtmlConversion: () => hook,
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, info: vi.fn() } }));

import HtmlTool, { MAX_HTML_BYTES } from "./index";

beforeEach(() => {
  hook.state = { kind: "idle" };
  vi.clearAllMocks();
});

/** The HTML editor's text area. */
const htmlBox = () => screen.getByLabelText(/^HTML/) as HTMLTextAreaElement;
/** The dropzone's hidden file input. */
const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;
const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });

describe("HtmlTool", () => {
  it("starts with the sample document and lists the engine's limits", () => {
    render(<HtmlTool />);
    expect(htmlBox().value).toBe(SAMPLE_HTML);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/Beta/);
    expect(note).toHaveTextContent(/@page/);
  });

  it("converts the current HTML and page settings", async () => {
    const user = userEvent.setup();
    render(<HtmlTool />);
    fireEvent.change(htmlBox(), { target: { value: "<h1>Hi</h1>" } });
    await user.selectOptions(screen.getByLabelText("Paper size"), "Legal");
    await user.click(screen.getByRole("button", { name: /Convert to PDF/ }));
    expect(hook.convert).toHaveBeenCalledWith({
      html: "<h1>Hi</h1>",
      page: { ...DEFAULT_PAGE_SETUP, size: "Legal" },
    });
    // every edit invalidates a previous PDF
    expect(hook.inputChanged).toHaveBeenCalledTimes(2);
  });

  it("disables conversion for empty HTML", () => {
    render(<HtmlTool />);
    fireEvent.change(htmlBox(), { target: { value: "  \n " } });
    expect(
      screen.getByRole("button", { name: /Convert to PDF/ }),
    ).toBeDisabled();
  });

  it("locks the inputs and offers Cancel while converting", async () => {
    hook.state = { kind: "converting" };
    const user = userEvent.setup();
    const { container } = render(<HtmlTool />);
    expect(htmlBox()).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Paper size")).toBeDisabled();
    expect(fileInput(container)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(hook.cancel).toHaveBeenCalled();
  });

  it("opens a file in its declared encoding and names the PDF after it", async () => {
    hook.state = { kind: "done", pdf };
    const user = userEvent.setup();
    const { container } = render(<HtmlTool />);
    // windows-1252 bytes: "café" with é = 0xE9, as Word's "Save as Web Page" writes it
    const bytes = Uint8Array.from(
      [...'<meta charset="windows-1252"><p>caf'].map((c) => c.charCodeAt(0)),
    );
    const file = new File([bytes, new Uint8Array([0xe9])], "invoice.htm", {
      type: "text/html",
    });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    await waitFor(() =>
      expect(htmlBox().value).toBe('<meta charset="windows-1252"><p>café'),
    );
    expect(screen.getByLabelText("HTML (invoice.htm)")).toBeInTheDocument();
    expect(hook.inputChanged).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    expect(download).toHaveBeenCalledWith(pdf, "invoice.pdf");
  });

  it("refuses files over the size limit", async () => {
    const { container } = render(<HtmlTool />);
    const big = new File(["x"], "big.html");
    Object.defineProperty(big, "size", { value: MAX_HTML_BYTES + 1 });
    fireEvent.change(fileInput(container), { target: { files: [big] } });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(htmlBox().value).toBe(SAMPLE_HTML);
  });

  it("rejects files that are not HTML", () => {
    const { container } = render(<HtmlTool />);
    fireEvent.change(fileInput(container), {
      target: { files: [new File(["x"], "notes.md", { type: "" })] },
    });
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("notes.md"),
    );
  });

  it("shows conversion errors", () => {
    hook.state = { kind: "error", reason: "failed", message: "Bad input" };
    render(<HtmlTool />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not create the PDF",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Bad input");
  });

  it("lists what the finished PDF lacks, for the HTML that was converted", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HtmlTool />);
    fireEvent.change(htmlBox(), {
      target: {
        value: '<link rel="stylesheet" href="site.css"><img src="logo.png">',
      },
    });
    await user.click(screen.getByRole("button", { name: /Convert to PDF/ }));
    // nothing is shown before the PDF exists, but the live region that will
    // announce it already does (screen readers ignore regions added late)
    expect(screen.queryByText(/not in the PDF/)).toBeNull();
    const region = screen.getByTestId("skipped-resources-region");
    expect(region).toHaveAttribute("aria-live", "polite");
    hook.state = { kind: "done", pdf };
    rerender(<HtmlTool />);
    const notice = screen.getByText("Some content is not in the PDF")
      .parentElement as HTMLElement;
    expect(notice).toHaveTextContent("1 image was left out");
    expect(notice).toHaveTextContent("1 linked stylesheet was left out");
    expect(region).toContainElement(notice);
  });

  it("shows no notice for the self-contained sample", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HtmlTool />);
    await user.click(screen.getByRole("button", { name: /Convert to PDF/ }));
    hook.state = { kind: "done", pdf };
    rerender(<HtmlTool />);
    expect(screen.queryByText(/not in the PDF/)).toBeNull();
  });
});
