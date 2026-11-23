import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./core/model";
import type { ApplyResult, OpenResult } from "./messages";
import { useWatermark } from "./use-watermark";
import type { WatermarkEngine } from "./watermark-engine";

/** An engine whose `open` answers are scripted per call. */
function fakeEngine(...answers: OpenResult[]) {
  const engine = {
    open: vi.fn(
      async () =>
        answers.shift() ?? ({ status: "opened", pageCount: 2 } as OpenResult),
    ),
    preview: vi.fn(async () => ({
      status: "rendered",
      width: 1,
      height: 1,
      pixels: new ArrayBuffer(4),
    })),
    apply: vi.fn(async (): Promise<ApplyResult> => ({
      status: "watermarked",
      data: new ArrayBuffer(1),
    })),
    close: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  return { engine, factory: () => engine as unknown as WatermarkEngine };
}

const pdf = (name = "a.pdf") =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });

describe("useWatermark", () => {
  it("opens a file and reports its page count", async () => {
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => useWatermark(factory));
    await act(() => result.current.openFile(pdf()));
    expect(engine.open).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    expect(result.current.status).toEqual({
      kind: "ready",
      fileName: "a.pdf",
      pageCount: 2,
    });
  });

  it("retries the same file with a password", async () => {
    const { engine, factory } = fakeEngine({ status: "password-required" });
    const { result } = renderHook(() => useWatermark(factory));
    await act(() => result.current.openFile(pdf("locked.pdf")));
    expect(result.current.status).toMatchObject({
      kind: "needs-password",
      wrong: false,
    });
    await act(() => result.current.submitPassword("hunter2"));
    expect(engine.open).toHaveBeenLastCalledWith(
      expect.any(ArrayBuffer),
      "hunter2",
    );
    expect(result.current.status).toMatchObject({
      kind: "ready",
      fileName: "locked.pdf",
    });
  });

  it("ignores the answer for a file closed while it was opening", async () => {
    let finish: (r: OpenResult) => void = () => {};
    const { engine, factory } = fakeEngine();
    engine.open.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const { result } = renderHook(() => useWatermark(factory));
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = result.current.openFile(pdf());
    });
    await waitFor(() => expect(engine.open).toHaveBeenCalled());
    act(() => result.current.close());
    await act(async () => {
      finish({ status: "opened", pageCount: 5 });
      await opening;
    });
    expect(result.current.status).toEqual({ kind: "empty" });
    expect(engine.close).toHaveBeenCalled();
  });

  it("reports a file that cannot be read", async () => {
    const { factory } = fakeEngine();
    const { result } = renderHook(() => useWatermark(factory));
    const broken = pdf();
    vi.spyOn(broken, "arrayBuffer").mockRejectedValue(
      new Error("NotReadableError"),
    );
    await act(() => result.current.openFile(broken));
    expect(result.current.status).toEqual({
      kind: "failed",
      fileName: "a.pdf",
      message: "NotReadableError",
    });
  });

  it("marks applying while the watermark is added", async () => {
    let finish: (r: ApplyResult) => void = () => {};
    const { engine, factory } = fakeEngine();
    engine.apply.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const { result } = renderHook(() => useWatermark(factory));
    let applying: Promise<ApplyResult> = Promise.resolve({
      status: "watermarked",
      data: new ArrayBuffer(0),
    });
    act(() => {
      applying = result.current.apply(DEFAULT_SETTINGS, [0]);
    });
    expect(result.current.applying).toBe(true);
    await act(async () => {
      finish({ status: "watermarked", data: new ArrayBuffer(3) });
      await applying;
    });
    expect(result.current.applying).toBe(false);
    expect(engine.apply).toHaveBeenCalledWith(DEFAULT_SETTINGS, [0]);
  });

  it("forwards previews and disposes the engine on unmount", async () => {
    const { engine, factory } = fakeEngine();
    const { result, unmount } = renderHook(() => useWatermark(factory));
    await result.current.preview(1, 200, undefined);
    expect(engine.preview).toHaveBeenCalledWith(1, 200, undefined, undefined);
    unmount();
    expect(engine.dispose).toHaveBeenCalled();
    expect(await result.current.preview(0, 1, undefined)).toMatchObject({
      status: "error",
    });
  });
});
