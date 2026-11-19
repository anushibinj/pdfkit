import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderResult } from "./messages";
import { PageCanvas, drawPixels } from "./page-canvas";

const putImageData = vi.fn();

beforeEach(() => {
  putImageData.mockClear();
  // jsdom has no canvas implementation
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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const rendered = (w = 2, h = 1): RenderResult => ({
  status: "rendered",
  width: w,
  height: h,
  pixels: new ArrayBuffer(w * h * 4),
});

describe("drawPixels", () => {
  it("sizes the canvas and puts the pixels at the origin", () => {
    const canvas = document.createElement("canvas");
    drawPixels(canvas, 2, 1, new ArrayBuffer(8));
    expect([canvas.width, canvas.height]).toEqual([2, 1]);
    expect(putImageData).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2, height: 1 }),
      0,
      0,
    );
  });

  it("does nothing more without a 2D context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const canvas = document.createElement("canvas");
    expect(() => drawPixels(canvas, 1, 1, new ArrayBuffer(4))).not.toThrow();
  });
});

describe("PageCanvas", () => {
  it("renders the page when active and paints the result", async () => {
    const renderPage = vi.fn(async () => rendered(3, 2));
    const { container } = render(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={4}
        rotation={1}
        width={512}
        active
      />,
    );
    expect(renderPage).toHaveBeenCalledWith(4, 1, 512, expect.any(AbortSignal));
    await waitFor(() => expect(putImageData).toHaveBeenCalled());
    const canvas = container.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([3, 2]);
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("waits while inactive and releases the bitmap when deactivated", async () => {
    const renderPage = vi.fn(async () => rendered());
    const { container, rerender } = render(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        active={false}
      />,
    );
    expect(renderPage).not.toHaveBeenCalled();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    rerender(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        active
      />,
    );
    await waitFor(() => expect(putImageData).toHaveBeenCalled());
    rerender(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        active={false}
      />,
    );
    expect(container.querySelector("canvas")!.width).toBe(0);
  });

  it("drops a render that finishes after its inputs changed", async () => {
    let finishFirst: (r: RenderResult) => void = () => {};
    const renderPage = vi
      .fn<(i: number, r: number, w: number) => Promise<RenderResult>>()
      .mockImplementationOnce(() => new Promise((r) => (finishFirst = r)))
      .mockImplementation(async () => rendered(4, 4));
    const { container, rerender } = render(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        active
      />,
    );
    rerender(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={1}
        width={512}
        active
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("canvas")!.width).toBe(4),
    );
    await act(async () => finishFirst(rendered(9, 9)));
    expect(container.querySelector("canvas")!.width).toBe(4);
  });

  it("aborts its request when the inputs change or the page scrolls away", () => {
    const signals: AbortSignal[] = [];
    const renderPage = vi.fn(
      (_i: number, _r: number, _w: number, signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return new Promise<RenderResult>(() => {});
      },
    );
    const { rerender } = render(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        active
      />,
    );
    rerender(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={1024}
        active
      />,
    );
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    rerender(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={1024}
        active={false}
      />,
    );
    expect(signals[1].aborted).toBe(true);
  });

  it("shows render errors", async () => {
    const renderPage = vi.fn(async (): Promise<RenderResult> => ({
      status: "error",
      reason: "failed",
      message: "broken page",
    }));
    render(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        active
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not show this page: broken page",
    );
  });
});
