import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OpenResult } from "./messages";
import type { PreviewEngine } from "./preview-engine";
import { useSplitDocument } from "./use-split-document";

const pages = [{ width: 600, height: 400 }];

/** A preview engine whose open answers are chosen per call. */
function fakeEngine(answers: (OpenResult | Promise<OpenResult>)[]) {
  const engine = {
    open: vi.fn(async () => answers.shift() ?? { status: "opened" as const, pages }),
    render: vi.fn(async () => ({
      status: "rendered" as const,
      width: 1,
      height: 1,
      pixels: new ArrayBuffer(4),
    })),
    close: vi.fn(async () => ({ status: "closed" as const })),
    dispose: vi.fn(),
  };
  return engine;
}

const pdf = (name = "a.pdf", bytes = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

function setup(answers: (OpenResult | Promise<OpenResult>)[] = []) {
  const engine = fakeEngine(answers);
  const hook = renderHook(() =>
    useSplitDocument(() => engine as unknown as PreviewEngine),
  );
  return { engine, ...hook };
}

describe("useSplitDocument", () => {
  it("opens a file and keeps its bytes for building files", async () => {
    const { result, engine } = setup();
    await act(() => result.current.openFile(pdf()));
    expect(result.current.status).toEqual({
      kind: "ready",
      fileName: "a.pdf",
      fileSize: 3,
      pages,
      withPassword: false,
    });
    expect(engine.open).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    const source = result.current.getSource();
    expect(source?.password).toBe("");
    expect(Array.from(new Uint8Array(source!.data))).toEqual([1, 2, 3]);
  });

  it("asks for a password, then opens with it and remembers it", async () => {
    const { result, engine } = setup([
      { status: "password-required" },
      { status: "wrong-password" },
    ]);
    await act(() => result.current.openFile(pdf()));
    expect(result.current.status).toMatchObject({ kind: "needs-password", wrong: false });
    expect(result.current.getSource()).toBeNull();
    await act(() => result.current.submitPassword("bad"));
    expect(result.current.status).toMatchObject({ kind: "needs-password", wrong: true });
    await act(() => result.current.submitPassword("hunter2"));
    expect(result.current.status).toMatchObject({ kind: "ready", withPassword: true });
    expect(engine.open).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), "hunter2");
    expect(result.current.getSource()?.password).toBe("hunter2");
  });

  it("reports a file that cannot be read", async () => {
    const { result, engine } = setup();
    const broken = pdf();
    broken.arrayBuffer = () => Promise.reject(new Error("NotReadableError"));
    await act(() => result.current.openFile(broken));
    expect(result.current.status).toEqual({
      kind: "failed",
      fileName: "a.pdf",
      message: "NotReadableError",
    });
    expect(engine.open).not.toHaveBeenCalled();
  });

  it("ignores a slow first file once a second one was picked", async () => {
    let finishFirst: (r: OpenResult) => void = () => {};
    const first = new Promise<OpenResult>((r) => (finishFirst = r));
    const { result } = setup([first, { status: "opened", pages }]);
    let firstOpen: Promise<void> = Promise.resolve();
    act(() => {
      firstOpen = result.current.openFile(pdf("slow.pdf"));
    });
    await act(() => result.current.openFile(pdf("fast.pdf")));
    await act(async () => {
      finishFirst({ status: "opened", pages: [] });
      await firstOpen;
    });
    expect(result.current.status).toMatchObject({ kind: "ready", fileName: "fast.pdf" });
  });

  it("close forgets the file and tells the engine", async () => {
    const { result, engine } = setup();
    await act(() => result.current.openFile(pdf()));
    act(() => result.current.close());
    expect(result.current.status).toEqual({ kind: "empty" });
    expect(result.current.getSource()).toBeNull();
    expect(engine.close).toHaveBeenCalled();
  });

  it("renders through the engine and disposes it on unmount", async () => {
    const { result, engine, unmount } = setup();
    const signal = new AbortController().signal;
    await act(() => result.current.renderPage(2, 120, signal));
    expect(engine.render).toHaveBeenCalledWith(2, 120, signal);
    unmount();
    expect(engine.dispose).toHaveBeenCalled();
    expect(await result.current.renderPage(0, 1)).toMatchObject({
      message: "The tool was closed.",
    });
  });
});
