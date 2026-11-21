import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./core/model";
import type { PreviewResult } from "./messages";
import {
  MAX_PREVIEW_WIDTH,
  PREVIEW_DELAY_MS,
  PreviewPane,
  previewWidth,
} from "./preview-pane";

const putImageData = vi.fn();
const rendered: PreviewResult = {
  status: "rendered",
  width: 2,
  height: 1,
  pixels: new ArrayBuffer(8),
};

beforeEach(() => {
  vi.useFakeTimers();
  putImageData.mockClear();
  // jsdom has no canvas, no layout and no ResizeObserver
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ putImageData }) as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal("ImageData", class {});
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPane(
  preview: (...args: never[]) => Promise<PreviewResult>,
  props: Partial<Parameters<typeof PreviewPane>[0]> = {},
) {
  const onPageChange = vi.fn();
  const utils = render(
    <PreviewPane
      pageCount={3}
      pageIndex={1}
      onPageChange={onPageChange}
      settings={DEFAULT_SETTINGS}
      preview={preview}
      {...props}
    />,
  );
  return { ...utils, onPageChange };
}

describe("previewWidth", () => {
  it("uses device pixels, rounded, within limits", () => {
    expect(previewWidth(300, 2)).toBe(600);
    expect(previewWidth(300.4, 1)).toBe(300);
    expect(previewWidth(5000, 2)).toBe(MAX_PREVIEW_WIDTH);
    expect(previewWidth(0, 1)).toBe(1);
    expect(previewWidth(300, Number.NaN)).toBe(300);
  });
});

describe("PreviewPane", () => {
  it("asks for a preview after a short pause and draws it", async () => {
    const preview = vi.fn(async () => rendered);
    renderPane(preview);
    expect(preview).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(preview).toHaveBeenCalledWith(
      1,
      previewWidth(300, window.devicePixelRatio),
      DEFAULT_SETTINGS,
      expect.any(AbortSignal),
    );
    expect(putImageData).toHaveBeenCalled();
    expect(
      screen.getByRole("img", { name: "Preview of page 2" }),
    ).toBeInTheDocument();
  });

  it("asks only once for a burst of changes, aborting the older request", async () => {
    const preview = vi.fn(async () => rendered);
    const { rerender } = renderPane(preview);
    const later = { ...DEFAULT_SETTINGS, opacity: 0.9 };
    rerender(
      <PreviewPane
        pageCount={3}
        pageIndex={1}
        onPageChange={vi.fn()}
        settings={later}
        preview={preview}
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(
      1,
      expect.any(Number),
      later,
      expect.any(AbortSignal),
    );
  });

  it("ignores a result that arrives after newer settings", async () => {
    let finish: (r: PreviewResult) => void = () => {};
    const preview = vi.fn(
      () => new Promise<PreviewResult>((r) => (finish = r)),
    );
    const { rerender } = renderPane(preview);
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    rerender(
      <PreviewPane
        pageCount={3}
        pageIndex={1}
        onPageChange={vi.fn()}
        settings={undefined}
        preview={preview}
      />,
    );
    await act(async () => finish(rendered));
    expect(putImageData).not.toHaveBeenCalled();
  });

  it("shows a failed preview", async () => {
    renderPane(async () => ({
      status: "error",
      reason: "failed",
      message: "These characters cannot be written",
    }));
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be written");
  });

  it("moves between pages and says when a page gets no watermark", () => {
    const { onPageChange } = renderPane(
      vi.fn(() => new Promise<PreviewResult>(() => {})),
      {
        settings: undefined,
      },
    );
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByText(/not watermarked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  it("disables the buttons at either end", () => {
    renderPane(
      vi.fn(() => new Promise<PreviewResult>(() => {})),
      {
        pageCount: 1,
        pageIndex: 0,
      },
    );
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});
