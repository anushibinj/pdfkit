import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OpenResult, RenderPageResult } from "./messages";
import { usePdfToImages, type ToolEngine } from "./use-pdf-to-images";

const options = { format: "png" as const, dpi: 72, quality: 0.9 };

const rendered = (pageIndex: number): RenderPageResult => ({
  status: "page",
  pageIndex,
  width: 1,
  height: 1,
  dpi: 72,
  reduced: false,
  mimeType: "image/png",
  data: new ArrayBuffer(1),
});

/** An engine whose `open` answers are scripted per call. */
function fakeEngine(...answers: OpenResult[]) {
  const engine = {
    open: vi.fn(
      async (): Promise<OpenResult> =>
        answers.shift() ?? { status: "opened", pageCount: 3 },
    ),
    renderPage: vi.fn(async (i: number) => rendered(i)),
    extractImages: vi.fn(async (pageIndex: number) => ({
      status: "images" as const,
      pageIndex,
      entries: [],
    })),
    close: vi.fn(async () => {}),
    dispose: vi.fn(),
  } satisfies ToolEngine;
  return { engine, factory: () => engine };
}

const pdf = (name = "a.pdf") =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });

describe("usePdfToImages", () => {
  it("opens a file and reports its page count", async () => {
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.openFile(pdf()));
    expect(engine.open).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    expect(result.current.document).toEqual({
      kind: "ready",
      fileName: "a.pdf",
      pageCount: 3,
    });
  });

  it("asks for a password, then retries the same bytes with it", async () => {
    const { engine, factory } = fakeEngine(
      { status: "password-required" },
      { status: "wrong-password" },
    );
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.openFile(pdf("locked.pdf")));
    expect(result.current.document).toMatchObject({
      kind: "needs-password",
      wrong: false,
    });
    await act(() => result.current.submitPassword("nope"));
    expect(result.current.document).toMatchObject({ wrong: true });
    await act(() => result.current.submitPassword("hunter2"));
    expect(result.current.document.kind).toBe("ready");
    const [first, , third] = engine.open.mock.calls as unknown as [
      ArrayBuffer,
      string,
    ][];
    expect(third[0]).toBe(first[0]);
    expect(third[1]).toBe("hunter2");
  });

  it("reports a file that cannot be read", async () => {
    const { factory } = fakeEngine();
    const { result } = renderHook(() => usePdfToImages(factory));
    const broken = pdf();
    vi.spyOn(broken, "arrayBuffer").mockRejectedValue(new Error("gone"));
    await act(() => result.current.openFile(broken));
    expect(result.current.document).toEqual({
      kind: "failed",
      fileName: "a.pdf",
      message: "Could not read the file: gone",
    });
  });

  it("ignores the answer for a file that was replaced meanwhile", async () => {
    let release: (r: OpenResult) => void = () => {};
    const { engine, factory } = fakeEngine();
    engine.open.mockImplementationOnce(
      () => new Promise<OpenResult>((resolve) => (release = resolve)),
    );
    const { result } = renderHook(() => usePdfToImages(factory));
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.openFile(pdf("old.pdf"));
    });
    // Let the old file be read and sent to the engine, where it waits.
    await vi.waitFor(() => expect(engine.open).toHaveBeenCalledTimes(1));
    await act(() => result.current.openFile(pdf("new.pdf")));
    await act(async () => {
      release({ status: "opened", pageCount: 99 });
      await first;
    });
    expect(result.current.document).toEqual({
      kind: "ready",
      fileName: "new.pdf",
      pageCount: 3,
    });
  });

  it("does not open a file whose read finished after it was replaced", async () => {
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(async () => {
      const old = result.current.openFile(pdf("old.pdf"));
      await result.current.openFile(pdf("new.pdf"));
      await old;
    });
    expect(engine.open).toHaveBeenCalledTimes(1);
    expect(result.current.document).toMatchObject({ fileName: "new.pdf" });
  });

  it("converts pages and collects the files", async () => {
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.openFile(pdf()));
    await act(() => result.current.convert("pages", [0, 2], options));
    expect(engine.renderPage).toHaveBeenCalledTimes(2);
    expect(result.current.run).toMatchObject({
      kind: "finished",
      stopped: false,
    });
    if (result.current.run.kind !== "finished") throw new Error("not finished");
    expect(result.current.run.files.map((f) => f.pages)).toEqual([[1], [3]]);
  });

  it("extracts images in images mode", async () => {
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.openFile(pdf()));
    await act(() => result.current.convert("images", [0], options));
    expect(engine.extractImages).toHaveBeenCalledWith(0, []);
    expect(result.current.run).toMatchObject({
      kind: "finished",
      mode: "images",
    });
  });

  it("stops after the current page", async () => {
    const { engine, factory } = fakeEngine();
    let release: () => void = () => {};
    engine.renderPage.mockImplementationOnce(async (i: number) => {
      await new Promise<void>((resolve) => (release = resolve));
      return rendered(i);
    });
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.openFile(pdf()));
    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current.convert("pages", [0, 1, 2], options);
    });
    act(() => result.current.stop());
    expect(result.current.run).toMatchObject({
      kind: "running",
      stopping: true,
    });
    await act(async () => {
      release();
      await running;
    });
    expect(engine.renderPage).toHaveBeenCalledTimes(1);
    expect(result.current.run).toMatchObject({
      kind: "finished",
      stopped: true,
    });
  });

  it("fails the run with the page's error and ignores a second start", async () => {
    const { engine, factory } = fakeEngine();
    engine.renderPage.mockResolvedValueOnce({
      status: "error",
      reason: "out-of-memory",
      message: "Out of memory.",
    });
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.openFile(pdf()));
    await act(() =>
      Promise.all([
        result.current.convert("pages", [0], options),
        result.current.convert("pages", [0], options),
      ]),
    );
    expect(engine.renderPage).toHaveBeenCalledTimes(1);
    expect(result.current.run).toMatchObject({
      kind: "failed",
      message: "Page 1: Out of memory.",
    });
  });

  it("does nothing for an empty selection", async () => {
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.convert("pages", [], options));
    expect(engine.renderPage).not.toHaveBeenCalled();
    expect(result.current.run.kind).toBe("idle");
  });

  it("closes the file, dropping results, and disposes the engine on unmount", async () => {
    const { engine, factory } = fakeEngine();
    const { result, unmount } = renderHook(() => usePdfToImages(factory));
    await act(() => result.current.openFile(pdf()));
    await act(() => result.current.convert("pages", [0], options));
    act(() => result.current.closeFile());
    expect(engine.close).toHaveBeenCalled();
    expect(result.current.document.kind).toBe("empty");
    expect(result.current.run.kind).toBe("idle");
    unmount();
    expect(engine.dispose).toHaveBeenCalled();
  });
});
