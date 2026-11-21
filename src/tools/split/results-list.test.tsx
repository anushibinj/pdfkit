import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MAX_LISTED_FILES, ResultsList, describeFilePages } from "./results-list";
import type { OutputFile } from "./use-split-outputs";

const file = (name: string, pages: number[], bytes = 2048): OutputFile => ({
  name,
  pages,
  data: new ArrayBuffer(bytes),
  crc32: 0,
});

describe("describeFilePages", () => {
  it.each([
    [[3], "Page 4"],
    [[0, 1, 2, 4], "Pages 1-3, 5"],
  ])("%j -> %s", (pages, text) => {
    expect(describeFilePages(pages)).toBe(text);
  });
});

describe("ResultsList", () => {
  it("lists one file with a Download button and no ZIP", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const only = file("a-extracted.pdf", [0, 2]);
    render(
      <ResultsList files={[only]} onDownload={onDownload} onDownloadAll={vi.fn()} />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Your file is ready");
    expect(screen.getByText("Pages 1, 3 · 2 KB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download all/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Download a-extracted.pdf" }));
    expect(onDownload).toHaveBeenCalledWith(only);
  });

  it("offers a ZIP of several files", async () => {
    const user = userEvent.setup();
    const onDownloadAll = vi.fn();
    render(
      <ResultsList
        files={[file("a-page-1.pdf", [0]), file("a-page-2.pdf", [1])]}
        onDownload={vi.fn()}
        onDownloadAll={onDownloadAll}
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("2 files are ready");
    await user.click(screen.getByRole("button", { name: "Download all (.zip)" }));
    expect(onDownloadAll).toHaveBeenCalled();
  });

  it("lists the first files only, and says the rest are in the ZIP", () => {
    const files = Array.from({ length: MAX_LISTED_FILES + 2 }, (_, i) =>
      file(`p-${i}.pdf`, [i], 10),
    );
    render(<ResultsList files={files} onDownload={vi.fn()} onDownloadAll={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Download p-/ })).toHaveLength(
      MAX_LISTED_FILES,
    );
    expect(screen.getByText("And 2 more files, all included in the ZIP.")).toBeInTheDocument();
  });

  it("shows qpdf's warnings", () => {
    render(
      <ResultsList
        files={[file("a.pdf", [0])]}
        warnings="Repaired the cross-reference table"
        onDownload={vi.fn()}
        onDownloadAll={vi.fn()}
      />,
    );
    expect(screen.getByText(/Repaired the cross-reference table/)).toBeInTheDocument();
  });
});
