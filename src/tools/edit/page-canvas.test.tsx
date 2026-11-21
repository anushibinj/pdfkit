import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderOptions } from "./editor-engine";
import type { RenderResult } from "./messages";
import { PageCanvas } from "./page-canvas";

const noEdits = [] as const;

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

const rendered = (w = 2, h = 1) => ({
  status: "rendered" as const,
  width: w,
  height: h,
  pixels: new ArrayBuffer(w * h * 4),
  textOutcomes: [],
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
        textEdits={noEdits}
        active
      />,
    );
    expect(renderPage).toHaveBeenCalledWith(4, 1, 512, {
      signal: expect.any(AbortSignal),
      textEdits: [],
    });
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
        textEdits={noEdits}
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
        textEdits={noEdits}
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
        textEdits={noEdits}
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
        textEdits={noEdits}
        active
      />,
    );
    rerender(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={1}
        width={512}
        textEdits={noEdits}
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
      (_i: number, _r: number, _w: number, options?: RenderOptions) => {
        if (options?.signal) signals.push(options.signal);
        return new Promise<RenderResult>(() => {});
      },
    );
    const { rerender } = render(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        textEdits={noEdits}
        active
      />,
    );
    rerender(
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={1024}
        textEdits={noEdits}
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
        textEdits={noEdits}
        active={false}
      />,
    );
    expect(signals[1].aborted).toBe(true);
  });

  it("renders text edits, reports their outcomes and keeps the old bitmap meanwhile", async () => {
    const outcome = {
      runId: "1",
      applied: true,
      failure: null,
      written: "New",
      substituteFont: "Helvetica",
    };
    let finish: (r: RenderResult) => void = () => {};
    const renderPage = vi
      .fn<
        (
          i: number,
          r: number,
          w: number,
          o?: RenderOptions,
        ) => Promise<RenderResult>
      >()
      .mockImplementationOnce(async () => rendered(3, 3))
      .mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const onTextOutcomes = vi.fn();
    const edits = [{ runId: "1", text: "New" }];
    const view = (textEdits: { runId: string; text: string }[]) => (
      <PageCanvas
        renderPage={renderPage}
        sourceIndex={0}
        rotation={0}
        width={512}
        textEdits={textEdits}
        active
        onTextOutcomes={onTextOutcomes}
      />
    );
    const { container, rerender } = render(view([]));
    await waitFor(() =>
      expect(container.querySelector("canvas")!.width).toBe(3),
    );
    rerender(view(edits));
    expect(renderPage).toHaveBeenLastCalledWith(0, 0, 512, {
      signal: expect.any(AbortSignal),
      textEdits: edits,
    });
    // the previous page stays visible until the new one is ready
    expect(container.querySelector("canvas")!.width).toBe(3);
    await act(async () =>
      finish({ ...rendered(5, 5), textOutcomes: [outcome] }),
    );
    expect(container.querySelector("canvas")!.width).toBe(5);
    expect(onTextOutcomes).toHaveBeenLastCalledWith(edits, [outcome]);
    // the same edits in a new array do not render again
    rerender(view([{ runId: "1", text: "New" }]));
    expect(renderPage).toHaveBeenCalledTimes(2);
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
        textEdits={noEdits}
        active
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not show this page: broken page",
    );
  });
});
