import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_REPORT } from "./core/report";
import type { CropEngine } from "./crop-engine";
import type { CropResult, OpenResult } from "./messages";
import { jobFromResult, usePdfCrop } from "./use-pdf-crop";

const pages = [
  { box: { left: 0, bottom: 0, right: 10, top: 10 }, rotation: 0 as const },
];
const plan = { removeOutside: true, pages: [] };

function fakeEngine(overrides: Partial<CropEngine> = {}) {
  return {
    open: vi.fn(async (): Promise<OpenResult> => ({ status: "opened", pages })),
    render: vi.fn(async () => ({
      status: "rendered" as const,
      width: 1,
      height: 1,
      pixels: new ArrayBuffer(4),
    })),
    crop: vi.fn(async (_plan, onProgress): Promise<CropResult> => {
      onProgress?.("checking", 0.5);
      return {
        status: "cropped",
        data: new ArrayBuffer(2),
        report: EMPTY_REPORT,
        verified: true,
      };
    }),
    close: vi.fn(async () => {}),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as CropEngine;
}

const file = (name = "a.pdf") => new File([Uint8Array.of(1)], name);

describe("jobFromResult", () => {
  it("maps each answer to a job status", () => {
    expect(
      jobFromResult(
        {
          status: "cropped",
          data: new ArrayBuffer(1),
          report: EMPTY_REPORT,
          verified: false,
        },
        false,
      ),
    ).toMatchObject({ kind: "done", removeOutside: false });
    const failed = jobFromResult(
      { status: "check-failed", pageIndex: 0, message: "Page 1: x." },
      true,
    );
    expect(failed).toMatchObject({ kind: "failed" });
    if (failed.kind === "failed") {
      expect(failed.message).toContain("safety check");
      expect(failed.message).toContain("Page 1: x.");
    }
    expect(
      jobFromResult({ status: "error", reason: "failed", message: "m" }, true),
    ).toEqual({ kind: "failed", message: "m" });
  });
});

describe("usePdfCrop", () => {
  it("opens a file and crops it", async () => {
    const engine = fakeEngine();
    const { result } = renderHook(() => usePdfCrop(() => engine));
    await act(() => result.current.openFile(file()));
    expect(result.current.status).toEqual({
      kind: "ready",
      fileName: "a.pdf",
      pages,
    });
    await act(() => result.current.crop(plan));
    expect(result.current.job).toMatchObject({
      kind: "done",
      removeOutside: true,
    });
    act(() => result.current.resetJob());
    expect(result.current.job).toEqual({ kind: "idle" });
  });

  it("shows progress while cropping", async () => {
    let finish: (r: CropResult) => void = () => {};
    const engine = fakeEngine({
      crop: vi.fn((_p, onProgress) => {
        onProgress?.("checking", 0.25);
        return new Promise<CropResult>((resolve) => (finish = resolve));
      }) as never,
    });
    const { result } = renderHook(() => usePdfCrop(() => engine));
    await act(() => result.current.openFile(file()));
    act(() => void result.current.crop(plan));
    await waitFor(() =>
      expect(result.current.job).toEqual({
        kind: "working",
        stage: "checking",
        fraction: 0.25,
      }),
    );
    await act(async () =>
      finish({ status: "error", reason: "failed", message: "no" }),
    );
    expect(result.current.job).toEqual({ kind: "failed", message: "no" });
  });

  it("ignores answers for a file that was closed in the meantime", async () => {
    let answer: (r: OpenResult) => void = () => {};
    const engine = fakeEngine({
      open: vi.fn(
        () => new Promise<OpenResult>((resolve) => (answer = resolve)),
      ) as never,
    });
    const { result } = renderHook(() => usePdfCrop(() => engine));
    act(() => void result.current.openFile(file()));
    await waitFor(() => expect(result.current.status.kind).toBe("opening"));
    act(() => result.current.close());
    await act(async () => answer({ status: "opened", pages }));
    expect(result.current.status).toEqual({ kind: "empty" });
    expect(engine.close).toHaveBeenCalled();
  });

  it("reports a file that cannot be read", async () => {
    const engine = fakeEngine();
    const { result } = renderHook(() => usePdfCrop(() => engine));
    const broken = file();
    vi.spyOn(broken, "arrayBuffer").mockRejectedValue(new Error("unreadable"));
    await act(() => result.current.openFile(broken));
    expect(result.current.status).toEqual({
      kind: "failed",
      fileName: "a.pdf",
      message: "unreadable",
    });
  });

  it("renders through the engine and disposes it on unmount", async () => {
    const engine = fakeEngine();
    const { result, unmount } = renderHook(() => usePdfCrop(() => engine));
    await act(async () => {
      await result.current.renderPage(0, 100);
    });
    expect(engine.render).toHaveBeenCalledWith(0, 100, undefined);
    unmount();
    expect(engine.dispose).toHaveBeenCalled();
    expect(await result.current.renderPage(0, 1)).toMatchObject({
      status: "error",
    });
  });
});
