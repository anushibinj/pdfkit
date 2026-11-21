import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderResult } from "./messages";
import { ThumbnailCanvas, type ThumbnailRenderer } from "./thumbnail-canvas";

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

const rendered = (w = 2, h = 3): RenderResult => ({
  status: "rendered",
  width: w,
  height: h,
  pixels: new ArrayBuffer(w * h * 4),
});

/** Mount the canvas; override any prop. */
function show(
  props: Partial<Parameters<typeof ThumbnailCanvas>[0]> = {},
  renderer: ThumbnailRenderer = vi.fn(async () => rendered()),
) {
  const view = render(
    <ThumbnailCanvas
      render={renderer}
      sourceId="s1"
      pageIndex={4}
      rotation={1}
      width={256}
      active
      {...props}
    />,
  );
  const canvas = () => view.container.querySelector("canvas")!;
  return { ...view, canvas, renderer };
}

describe("ThumbnailCanvas", () => {
  it("asks for the page at its width and draws the pixels", async () => {
    const { canvas, renderer } = show();
    await waitFor(() => expect(putImageData).toHaveBeenCalled());
    expect(renderer).toHaveBeenCalledWith(
      "s1",
      4,
      1,
      256,
      expect.any(AbortSignal),
    );
    expect([canvas().width, canvas().height]).toEqual([2, 3]);
    // The loading placeholder is gone once drawn.
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("does not render while inactive or before the width is known", () => {
    const renderer = vi.fn(async () => rendered());
    show({ active: false }, renderer);
    show({ width: 0 }, renderer);
    expect(renderer).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(2);
  });

  it("aborts a render whose inputs changed and ignores its late answer", async () => {
    let finishFirst!: (r: RenderResult) => void;
    const renderer = vi
      .fn<ThumbnailRenderer>()
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = resolve)),
      )
      .mockResolvedValue(rendered(5, 5));
    const view = show({}, renderer);
    const firstSignal = renderer.mock.calls[0][4]!;
    view.rerender(
      <ThumbnailCanvas
        render={renderer}
        sourceId="s1"
        pageIndex={4}
        rotation={1}
        width={512}
        active
      />,
    );
    expect(firstSignal.aborted).toBe(true);
    await waitFor(() => expect(view.canvas().width).toBe(5));
    finishFirst(rendered(1, 1));
    await Promise.resolve();
    expect(view.canvas().width).toBe(5);
  });

  it("releases the bitmap when it scrolls away", async () => {
    const view = show();
    await waitFor(() => expect(view.canvas().width).toBe(2));
    view.rerender(
      <ThumbnailCanvas
        render={view.renderer}
        sourceId="s1"
        pageIndex={4}
        rotation={1}
        width={256}
        active={false}
      />,
    );
    expect([view.canvas().width, view.canvas().height]).toEqual([0, 0]);
    expect(document.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows why a page could not be drawn", async () => {
    show(
      {},
      vi.fn(async () => ({
        status: "error" as const,
        reason: "failed" as const,
        message: "That file is not open any more.",
      })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not show this page: That file is not open any more.",
    );
  });
});
