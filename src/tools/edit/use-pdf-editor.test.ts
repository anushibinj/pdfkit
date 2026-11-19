import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorEngine } from "./editor-engine";
import type { OpenResult } from "./messages";
import { usePdfEditor } from "./use-pdf-editor";

const page = {
  box: { left: 0, bottom: 0, right: 10, top: 10 },
  rotation: 0 as const,
};

/** An engine whose `open` answers are scripted per call. */
function fakeEngine(...answers: OpenResult[]) {
  const engine = {
    open: vi.fn(
      async () =>
        answers.shift() ?? ({ status: "opened", pages: [page] } as OpenResult),
    ),
    render: vi.fn(async () => ({
      status: "rendered",
      width: 1,
      height: 1,
      pixels: new ArrayBuffer(4),
    })),
    save: vi.fn(async () => ({ status: "saved", data: new ArrayBuffer(1) })),
    close: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  return { engine, factory: () => engine as unknown as EditorEngine };
}

const pdf = (name = "a.pdf") =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: () => "blob:x",
    revokeObjectURL: vi.fn(),
  });
});

describe("usePdfEditor", () => {
  it("opens a file and loads its pages into the editor", async () => {
    const { engine, factory } = fakeEngine({
      status: "opened",
      pages: [page, page],
    });
    const { result } = renderHook(() => usePdfEditor(factory));
    await act(() => result.current.openFile(pdf()));
    expect(engine.open).toHaveBeenCalledWith(expect.any(ArrayBuffer), "");
    expect(result.current.status).toEqual({
      kind: "ready",
      fileName: "a.pdf",
      pages: [page, page],
    });
    expect(result.current.editor.history.present.pages).toHaveLength(2);
  });

  it("asks for a password, then retries the same bytes with it", async () => {
    const { engine, factory } = fakeEngine(
      { status: "password-required" },
      { status: "wrong-password" },
    );
    const { result } = renderHook(() => usePdfEditor(factory));
    await act(() => result.current.openFile(pdf("locked.pdf")));
    expect(result.current.status).toEqual({
      kind: "needs-password",
      fileName: "locked.pdf",
      wrong: false,
    });
    await act(() => result.current.submitPassword("nope"));
    expect(result.current.status).toMatchObject({
      kind: "needs-password",
      wrong: true,
    });
    await act(() => result.current.submitPassword("hunter2"));
    expect(result.current.status.kind).toBe("ready");
    const [first, , third] = engine.open.mock.calls as unknown as [
      ArrayBuffer,
      string,
    ][];
    expect(third[0]).toBe(first[0]);
    expect(third[1]).toBe("hunter2");
  });

  it("reports files that cannot be read", async () => {
    const { factory } = fakeEngine();
    const { result } = renderHook(() => usePdfEditor(factory));
    const broken = pdf("broken.pdf");
    broken.arrayBuffer = () => Promise.reject(new Error("read error"));
    await act(() => result.current.openFile(broken));
    expect(result.current.status).toEqual({
      kind: "failed",
      fileName: "broken.pdf",
      message: "read error",
    });
  });

  it("ignores an open that finishes after the file was closed", async () => {
    let finish: (r: OpenResult) => void = () => {};
    const { engine, factory } = fakeEngine();
    engine.open.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const { result } = renderHook(() => usePdfEditor(factory));
    let opening: Promise<void> = Promise.resolve();
    await act(async () => {
      opening = result.current.openFile(pdf());
      await Promise.resolve();
    });
    act(() => result.current.close());
    await act(async () => {
      finish({ status: "opened", pages: [page] });
      await opening;
    });
    expect(result.current.status).toEqual({ kind: "empty" });
    expect(engine.close).toHaveBeenCalled();
  });

  it("saves the current document with the images it uses", async () => {
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => usePdfEditor(factory));
    await act(() => result.current.openFile(pdf()));
    act(() =>
      result.current.addImage({
        id: "img",
        mime: "image/png",
        bytes: new ArrayBuffer(2),
        pixelWidth: 1,
        pixelHeight: 1,
      }),
    );
    act(() =>
      result.current.dispatch({
        type: "add-object",
        pageKey: "p0",
        object: {
          id: "o",
          kind: "image",
          x: 0,
          y: 0,
          rotation: 0,
          width: 5,
          height: 5,
          imageId: "img",
        },
      }),
    );
    let saved: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved?.status).toBe("saved");
    const plan = engine.save.mock.calls[0] as unknown as [
      { pages: unknown[]; images: { id: string }[] },
    ];
    expect(plan[0].images.map((i) => i.id)).toEqual(["img"]);
    expect(result.current.saving).toBe(false);
  });

  it("turns a plan that cannot be built into an error result", async () => {
    const { factory } = fakeEngine();
    const { result } = renderHook(() => usePdfEditor(factory));
    await act(() => result.current.openFile(pdf()));
    act(() =>
      result.current.dispatch({
        type: "add-object",
        pageKey: "p0",
        object: {
          id: "o",
          kind: "image",
          x: 0,
          y: 0,
          rotation: 0,
          width: 5,
          height: 5,
          imageId: "missing",
        },
      }),
    );
    let saved: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved).toMatchObject({
      status: "error",
      message: "Missing image missing",
    });
  });

  it("renders pages through the engine", async () => {
    const signal = new AbortController().signal;
    const { engine, factory } = fakeEngine();
    const { result } = renderHook(() => usePdfEditor(factory));
    await act(async () => {
      await result.current.renderPage(0, 1, 512, signal);
    });
    expect(engine.render).toHaveBeenCalledWith(0, 1, 512, signal);
  });

  it("close resets everything and unmount disposes the engine", async () => {
    const { engine, factory } = fakeEngine();
    const { result, unmount } = renderHook(() => usePdfEditor(factory));
    await act(() => result.current.openFile(pdf()));
    act(() => result.current.close());
    expect(result.current.status).toEqual({ kind: "empty" });
    expect(result.current.editor.history.present.pages).toEqual([]);
    unmount();
    expect(engine.dispose).toHaveBeenCalled();
    // after unmount, requests resolve with an error instead of throwing
    await expect(result.current.renderPage(0, 0, 1)).resolves.toMatchObject({
      status: "error",
    });
    await expect(result.current.save()).resolves.toMatchObject({
      status: "error",
    });
  });
});
