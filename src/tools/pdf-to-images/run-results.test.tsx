import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputFile, RunState } from "./core/run-state";
import {
  RunResults,
  SMALL_PREVIEW_PX,
  fileDetails,
  pagesLabel,
  previewClass,
} from "./run-results";

const downloadBlob = vi.fn();
vi.mock("@/lib/download", () => ({
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
}));
const createZip = vi.fn<(entries: unknown, modified: Date) => Blob>(
  () => new Blob(["zip"]),
);
vi.mock("@/lib/zip/zip", () => ({
  blobZipEntry: async (name: string, data: Blob) => ({ name, data, crc32: 0 }),
  createZip: (entries: unknown, modified: Date) => createZip(entries, modified),
}));

beforeEach(() => {
  downloadBlob.mockClear();
  createZip.mockClear();
  Object.assign(URL, {
    createObjectURL: () => "blob:x",
    revokeObjectURL: vi.fn(),
  });
});

const pageFile = (
  page: number,
  extra: Partial<OutputFile> = {},
): OutputFile => ({
  id: `page-${page - 1}`,
  blob: new Blob([new Uint8Array(2048)], { type: "image/png" }),
  mimeType: "image/png",
  width: 1240,
  height: 1754,
  pages: [page],
  dpi: 150,
  reduced: false,
  ...extra,
});

const finished = (
  files: OutputFile[],
  extra: Partial<Extract<RunState, { kind: "finished" }>> = {},
): Extract<RunState, { kind: "finished" }> => ({
  kind: "finished",
  mode: "pages",
  files,
  skipped: [],
  stopped: false,
  ...extra,
});

function show(run: Exclude<RunState, { kind: "idle" }>, onError = vi.fn()) {
  render(
    <RunResults run={run} baseName="report" pageCount={12} onError={onError} />,
  );
  return { onError };
}

describe("pagesLabel and fileDetails", () => {
  it("names one page or several", () => {
    expect(pagesLabel([3])).toBe("Page 3");
    expect(pagesLabel([1, 4, 9])).toBe("Pages 1, 4, 9");
  });

  it("describes size, resolution, format and file size", () => {
    expect(fileDetails(pageFile(1))).toBe(
      "1240 × 1754 px · 150 DPI · PNG · 2 KB",
    );
    expect(
      fileDetails({
        ...pageFile(1),
        dpi: undefined,
        mimeType: "image/jpeg",
        method: "original-jpeg",
      }),
    ).toBe("1240 × 1754 px · Original JPEG · 2 KB");
    expect(
      fileDetails({ ...pageFile(1), dpi: undefined, mimeType: "image/jpeg" }),
    ).toMatch(/JPEG/);
  });
});

describe("previewClass", () => {
  it("enlarges small images crisply and shrinks large ones smoothly", () => {
    expect(previewClass({ width: 24, height: 16 })).toContain("pixelated");
    expect(previewClass({ width: SMALL_PREVIEW_PX, height: 10 })).toContain(
      "w-full",
    );
    expect(
      previewClass({ width: SMALL_PREVIEW_PX + 1, height: 10 }),
    ).not.toContain("pixelated");
    expect(previewClass({ width: 1240, height: 1754 })).toContain("max-h-full");
  });
});

describe("RunResults", () => {
  it("shows progress while running, without downloads", () => {
    show({
      kind: "running",
      mode: "pages",
      done: 1,
      total: 4,
      files: [pageFile(1)],
      skipped: [],
      stopping: false,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Page 2 of 4…");
    expect(
      screen.getByRole("progressbar", { name: "Conversion progress" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("says when it is stopping", () => {
    show({
      kind: "running",
      mode: "pages",
      done: 1,
      total: 4,
      files: [],
      skipped: [],
      stopping: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Stopping after this page…",
    );
  });

  it("lists files with names padded to the page count, and downloads one", async () => {
    const user = userEvent.setup();
    const files = [pageFile(3), pageFile(12)];
    show(finished(files));
    expect(
      screen.getByRole("heading", { name: "2 pages" }),
    ).toBeInTheDocument();
    expect(screen.getByText("report-page-03.png")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Page 3, page 1" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Download report-page-12.png" }),
    );
    expect(downloadBlob).toHaveBeenCalledWith(
      files[1].blob,
      "report-page-12.png",
    );
  });

  it("zips every file under its name", async () => {
    const user = userEvent.setup();
    const files = [pageFile(1), pageFile(2)];
    show(finished(files));
    await user.click(
      screen.getByRole("button", { name: "Download all (ZIP)" }),
    );
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(createZip).toHaveBeenCalledWith(
      [
        { name: "report-page-01.png", data: files[0].blob, crc32: 0 },
        { name: "report-page-02.png", data: files[1].blob, crc32: 0 },
      ],
      expect.any(Date),
    );
    expect(downloadBlob.mock.calls[0][1]).toBe("report-pages.zip");
  });

  it("reports a ZIP that cannot be built", async () => {
    const user = userEvent.setup();
    createZip.mockImplementationOnce(() => {
      throw new Error("too big");
    });
    const { onError } = show(finished([pageFile(1), pageFile(2)]));
    await user.click(
      screen.getByRole("button", { name: "Download all (ZIP)" }),
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Could not create the ZIP: too big"),
    );
    expect(
      screen.getByRole("button", { name: "Download all (ZIP)" }),
    ).toBeEnabled();
  });

  it("offers no ZIP for a single file", () => {
    show(finished([pageFile(1)]));
    expect(
      screen.queryByRole("button", { name: "Download all (ZIP)" }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "1 page" })).toBeInTheDocument();
  });

  it("notes pages rendered at a lower resolution", () => {
    show(finished([pageFile(2, { reduced: true, dpi: 415 })]));
    expect(
      screen.getByText(/Page 2 was rendered at a lower resolution/),
    ).toBeInTheDocument();
  });

  it("names images by position, shows their pages and lists skipped ones", () => {
    const image: OutputFile = {
      id: "k1",
      blob: new Blob(["j"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      width: 32,
      height: 24,
      pages: [1, 4],
      method: "original-jpeg",
    };
    show(
      finished([image], {
        mode: "images",
        skipped: [
          { key: "k2", page: 3, width: 9e3, height: 9e3, reason: "Too large." },
        ],
      }),
    );
    expect(screen.getByText("report-image-01.jpg")).toBeInTheDocument();
    expect(screen.getByText("Pages 1, 4")).toBeInTheDocument();
    expect(screen.getByText(/Original JPEG/)).toBeInTheDocument();
    expect(
      screen.getByText("1 image could not be extracted"),
    ).toBeInTheDocument();
    expect(screen.getByText("Page 3: Too large.")).toBeInTheDocument();
  });

  it("says when no images were found, when stopped, and when failed", () => {
    const { unmount } = render(
      <RunResults
        run={finished([], { mode: "images" })}
        baseName="r"
        pageCount={1}
        onError={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No images were found on the selected pages."),
    ).toBeInTheDocument();
    unmount();
    const second = render(
      <RunResults
        run={finished([], { stopped: true })}
        baseName="r"
        pageCount={1}
        onError={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Stopped. The pages converted so far/),
    ).toBeInTheDocument();
    second.rerender(
      <RunResults
        run={finished([], { stopped: true, mode: "images" })}
        baseName="r"
        pageCount={1}
        onError={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Stopped. The images extracted so far/),
    ).toBeInTheDocument();
    second.unmount();
    show({
      kind: "failed",
      mode: "pages",
      files: [],
      skipped: [],
      message: "Page 2: Out of memory.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Page 2: Out of memory.",
    );
  });
});
