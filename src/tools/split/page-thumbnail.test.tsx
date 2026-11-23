import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderResult } from "./messages";
import { PageThumbnail, RENDER_STEP, renderWidthFor } from "./page-thumbnail";

const putImageData = vi.fn();

beforeEach(() => {
  putImageData.mockClear();
  // jsdom has no canvas and no layout: fake both.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ putImageData }) as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(150);
  vi.stubGlobal("devicePixelRatio", 2);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const rendered: RenderResult = {
  status: "rendered",
  width: 320,
  height: 452,
  pixels: new ArrayBuffer(320 * 452 * 4),
};

const size = { width: 595, height: 842 };

describe("renderWidthFor", () => {
  it("scales by the pixel ratio and rounds up to the render step", () => {
    expect(renderWidthFor(150, 2)).toBe(320);
    expect(renderWidthFor(150, 1)).toBe(192);
    expect(renderWidthFor(10, 1)).toBe(RENDER_STEP);
  });

  it("is 0 before the width is known, and treats a bad ratio as 1", () => {
    expect(renderWidthFor(0, 2)).toBe(0);
    expect(renderWidthFor(150, Number.NaN)).toBe(192);
    expect(renderWidthFor(150, 0)).toBe(192);
  });
});

describe("PageThumbnail", () => {
  it("draws the page at the measured width once it is near the screen", async () => {
    const renderPage = vi.fn(async () => rendered);
    render(
      <ul>
        <PageThumbnail pageIndex={4} size={size} renderPage={renderPage} mark="none" />
      </ul>,
    );
    await waitFor(() => expect(putImageData).toHaveBeenCalled());
    expect(renderPage).toHaveBeenCalledWith(4, 320, expect.any(AbortSignal));
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("is a toggle button when it can be picked, passing Shift", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ul>
        <PageThumbnail
          pageIndex={2}
          size={size}
          renderPage={async () => rendered}
          mark="picked"
          onToggle={onToggle}
        />
      </ul>,
    );
    const button = screen.getByRole("button", { name: "Page 3" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(2, false);
    await user.keyboard("{Shift>}");
    await user.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(2, true);
  });

  it("shows only (no button) with a caption in split mode", () => {
    render(
      <ul>
        <PageThumbnail
          pageIndex={0}
          size={size}
          renderPage={async () => rendered}
          mark="none"
          caption="File 1"
        />
      </ul>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("File 1")).toBeInTheDocument();
  });

  it("keeps its drawn canvas when it becomes clickable (mode switch)", async () => {
    // Regression: the picture used to be wrapped in a <div> or a <button>
    // depending on the mode, so a mode switch replaced the canvas with a
    // blank one that was never drawn again.
    const renderPage = vi.fn(async () => rendered);
    const { container, rerender } = render(
      <ul>
        <PageThumbnail pageIndex={0} size={size} renderPage={renderPage} mark="none" />
      </ul>,
    );
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
    const canvas = container.querySelector("canvas");
    rerender(
      <ul>
        <PageThumbnail
          pageIndex={0}
          size={size}
          renderPage={renderPage}
          mark="picked"
          onToggle={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Page 1" })).toBeInTheDocument();
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(canvas?.width).toBe(320);
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("says when a page cannot be drawn", async () => {
    render(
      <ul>
        <PageThumbnail
          pageIndex={0}
          size={size}
          renderPage={async () => ({
            status: "error",
            reason: "failed",
            message: "bad page",
          })}
          mark="none"
        />
      </ul>,
    );
    expect(await screen.findByText("Could not show this page")).toBeInTheDocument();
  });

  it("ignores a render that finishes after the thumbnail went away", async () => {
    let finish: (r: RenderResult) => void = () => {};
    const renderPage = vi.fn(
      (_i: number, _w: number, signal?: AbortSignal) =>
        new Promise<RenderResult>((resolve) => {
          finish = resolve;
          expect(signal).toBeDefined();
        }),
    );
    const { unmount } = render(
      <ul>
        <PageThumbnail pageIndex={0} size={size} renderPage={renderPage} mark="none" />
      </ul>,
    );
    await waitFor(() => expect(renderPage).toHaveBeenCalled());
    const signal = renderPage.mock.calls[0][2]!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(rendered));
    expect(putImageData).not.toHaveBeenCalled();
  });
});
