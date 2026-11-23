import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_BOARD_PAGES } from "./core/board";
import type { OpenResult } from "./messages";
import type { OrganizeEngine } from "./organize-engine";
import { MAX_FILE_BYTES, useOrganizer } from "./use-organizer";

const page = {
  box: { left: 0, bottom: 0, right: 10, top: 10 },
  rotation: 0 as const,
};
const opened = (pages = 2): OpenResult => ({
  status: "opened",
  pages: Array(pages).fill(page),
});

/** A fake engine; `open` answers from `answers` (default: 2 pages). */
function fakeEngine(answers: OpenResult[] = []) {
  const engine = {
    open: vi.fn(async () => answers.shift() ?? opened()),
    render: vi.fn(async () => ({
      status: "rendered" as const,
      width: 1,
      height: 1,
      pixels: new ArrayBuffer(4),
    })),
    save: vi.fn(async () => ({
      status: "saved" as const,
      data: new ArrayBuffer(3),
    })),
    close: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  return engine;
}

/** Mount the hook over a fake engine. */
function setup(answers?: OpenResult[]) {
  const engine = fakeEngine(answers);
  const notify = vi.fn();
  const hook = renderHook(() =>
    useOrganizer({
      createEngine: () => engine as unknown as OrganizeEngine,
      notify,
    }),
  );
  return { engine, notify, hook };
}
const pdf = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

describe("useOrganizer", () => {
  it("adds each opened file's pages, with colour slots in order", async () => {
    const { hook } = setup([opened(2), opened(1)]);
    act(() => hook.result.current.addFiles([pdf("a.pdf"), pdf("b.pdf")]));
    await waitFor(() =>
      expect(hook.result.current.state.history.present).toHaveLength(3),
    );
    const { sources } = hook.result.current.state;
    expect(sources.map((s) => [s.name, s.colorIndex])).toEqual([
      ["a.pdf", 0],
      ["b.pdf", 1],
    ]);
    expect(hook.result.current.opening).toBeNull();
  });

  it("asks for a password, keeps the prompt up while checking, then closes it", async () => {
    const { engine, hook } = setup([
      { status: "password-required" },
      { status: "wrong-password" },
      opened(1),
    ]);
    act(() => hook.result.current.addFiles([pdf("locked.pdf")]));
    await waitFor(() =>
      expect(hook.result.current.passwordRequest).toEqual({
        fileName: "locked.pdf",
        wrong: false,
        checking: false,
      }),
    );
    act(() => hook.result.current.answerPassword("nope"));
    await waitFor(() =>
      expect(hook.result.current.passwordRequest).toMatchObject({
        wrong: true,
        checking: false,
      }),
    );
    act(() => hook.result.current.answerPassword("hunter2"));
    await waitFor(() => expect(hook.result.current.passwordRequest).toBeNull());
    expect(engine.open).toHaveBeenLastCalledWith(
      "s1",
      expect.any(ArrayBuffer),
      "hunter2",
    );
    expect(hook.result.current.state.sources[0].passwordProtected).toBe(true);
  });

  it("skipping the password closes the prompt and adds nothing", async () => {
    const { hook } = setup([{ status: "password-required" }]);
    act(() => hook.result.current.addFiles([pdf("locked.pdf")]));
    await waitFor(() =>
      expect(hook.result.current.passwordRequest).not.toBeNull(),
    );
    act(() => hook.result.current.answerPassword(null));
    await waitFor(() => expect(hook.result.current.opening).toBeNull());
    expect(hook.result.current.passwordRequest).toBeNull();
    expect(hook.result.current.state.sources).toHaveLength(0);
  });

  it("tells the user about files it could not open", async () => {
    const { notify, hook } = setup([
      { status: "error", reason: "failed", message: "Not a PDF." },
    ]);
    act(() =>
      hook.result.current.addFiles([
        pdf("bad.pdf"),
        pdf("huge.pdf", MAX_FILE_BYTES + 1),
      ]),
    );
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith("Could not open bad.pdf. Not a PDF.");
    expect(notify.mock.calls[1][0]).toMatch(
      /^Could not open huge.pdf. It is over/,
    );
  });

  it("refuses a file that would go over the page limit and closes it", async () => {
    const { engine, notify, hook } = setup([
      opened(MAX_BOARD_PAGES),
      opened(1),
    ]);
    act(() => hook.result.current.addFiles([pdf("big.pdf"), pdf("one.pdf")]));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0][0]).toContain("one.pdf was not added");
    expect(engine.close).toHaveBeenCalledWith("s2");
    expect(hook.result.current.state.sources.map((s) => s.name)).toEqual([
      "big.pdf",
    ]);
  });

  it("clear closes every file, resets colours and empties the board", async () => {
    const { engine, hook } = setup();
    act(() => hook.result.current.addFiles([pdf("a.pdf")]));
    await waitFor(() =>
      expect(hook.result.current.state.sources).toHaveLength(1),
    );
    act(() => hook.result.current.clear());
    expect(engine.close).toHaveBeenCalledWith();
    expect(hook.result.current.state.sources).toHaveLength(0);
    act(() => hook.result.current.addFiles([pdf("b.pdf")]));
    await waitFor(() =>
      expect(hook.result.current.state.sources).toHaveLength(1),
    );
    expect(hook.result.current.state.sources[0].colorIndex).toBe(0);
  });

  it("clear dismisses a pending password prompt", async () => {
    const { hook } = setup([{ status: "password-required" }]);
    act(() => hook.result.current.addFiles([pdf("locked.pdf")]));
    await waitFor(() =>
      expect(hook.result.current.passwordRequest).not.toBeNull(),
    );
    act(() => hook.result.current.clear());
    expect(hook.result.current.passwordRequest).toBeNull();
  });

  it("saves the board as output pages and reports saving", async () => {
    const { engine, hook } = setup([opened(2)]);
    act(() => hook.result.current.addFiles([pdf("a.pdf")]));
    await waitFor(() =>
      expect(hook.result.current.state.history.present).toHaveLength(2),
    );
    let result: Awaited<ReturnType<typeof hook.result.current.save>>;
    await act(async () => {
      result = await hook.result.current.save();
    });
    expect(result!).toMatchObject({ status: "saved" });
    expect(engine.save).toHaveBeenCalledWith([
      { kind: "source", sourceId: "s1", pageIndex: 0, rotation: 0 },
      { kind: "source", sourceId: "s1", pageIndex: 1, rotation: 0 },
    ]);
    expect(hook.result.current.saving).toBe(false);
  });

  it("turns a thrown save into an error result", async () => {
    const { engine, hook } = setup();
    engine.save.mockRejectedValueOnce(new Error("bad plan"));
    let result: Awaited<ReturnType<typeof hook.result.current.save>>;
    await act(async () => {
      result = await hook.result.current.save();
    });
    expect(result!).toEqual({
      status: "error",
      reason: "failed",
      message: "bad plan",
    });
  });

  it("renders through the engine, and disposes it on unmount", async () => {
    const { engine, hook } = setup();
    await hook.result.current.render("s1", 3, 1, 200);
    expect(engine.render).toHaveBeenCalledWith("s1", 3, 1, 200, undefined);
    hook.unmount();
    expect(engine.dispose).toHaveBeenCalled();
    expect(await hook.result.current.render("s1", 0, 0, 1)).toMatchObject({
      message: "The organizer was closed.",
    });
  });
});
