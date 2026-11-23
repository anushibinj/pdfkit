import { describe, expect, it, vi } from "vitest";
import type { OpenResult } from "./messages";
import { OpenQueue, type OpenQueueDeps } from "./open-queue";

const page = {
  box: { left: 0, bottom: 0, right: 10, top: 10 },
  rotation: 0 as const,
};
const opened = (pages = 1): OpenResult => ({
  status: "opened",
  pages: Array(pages).fill(page),
});
const limits = { maxFileBytes: 100, maxTotalBytes: 150 };

/** A file of `size` bytes. */
const file = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name);

/**
 * Deps where every file opens with one page; override per test. The log
 * records the order of interesting calls.
 */
function setup(overrides: Partial<OpenQueueDeps> = {}) {
  const log: string[] = [];
  let id = 0;
  const deps: OpenQueueDeps = {
    read: vi.fn(async (f: File) => f.arrayBuffer()),
    open: vi.fn(async (fileId: string, _data: ArrayBuffer, pw: string) => {
      log.push(`open ${fileId} "${pw}"`);
      return opened();
    }),
    askPassword: vi.fn(async () => null),
    onOpened: vi.fn((f) => {
      log.push(`added ${f.name}${f.passwordProtected ? " (pw)" : ""}`);
      return true;
    }),
    close: vi.fn((fileId: string) => log.push(`close ${fileId}`)),
    onFailed: vi.fn((name: string, message: string) =>
      log.push(`failed ${name}: ${message}`),
    ),
    onBusy: vi.fn(),
    newId: () => `s${++id}`,
    ...overrides,
  };
  return { deps, log, queue: new OpenQueue(deps, limits) };
}

describe("OpenQueue", () => {
  it("opens files one after another, in order, and reports idle", async () => {
    const { deps, log, queue } = setup();
    await queue.add([file("a.pdf"), file("b.pdf")]);
    expect(log).toEqual([
      'open s1 ""',
      "added a.pdf",
      'open s2 ""',
      "added b.pdf",
    ]);
    expect(deps.onBusy).toHaveBeenCalledWith("a.pdf");
    expect(deps.onBusy).toHaveBeenLastCalledWith(null);
    expect(queue.isBusy()).toBe(false);
  });

  it("asks for a password, retries, and marks the file protected", async () => {
    const answers = ["wrong", "hunter2"];
    const { deps, log, queue } = setup({
      open: vi.fn(async (fileId: string, _d: ArrayBuffer, pw: string) => {
        log.push(`open ${fileId} "${pw}"`);
        if (pw === "") return { status: "password-required" } as const;
        return pw === "hunter2"
          ? opened()
          : ({ status: "wrong-password" } as const);
      }),
      askPassword: vi.fn(async () => answers.shift() ?? null),
    });
    await queue.add([file("locked.pdf")]);
    expect(deps.askPassword).toHaveBeenNthCalledWith(1, "locked.pdf", false);
    expect(deps.askPassword).toHaveBeenNthCalledWith(2, "locked.pdf", true);
    expect(log).toEqual([
      'open s1 ""',
      'open s1 "wrong"',
      'open s1 "hunter2"',
      "added locked.pdf (pw)",
    ]);
  });

  it("skips a file whose password prompt is dismissed and moves on", async () => {
    const { log, queue } = setup({
      open: vi.fn(async (fileId: string) => {
        log.push(`open ${fileId}`);
        return fileId === "s1"
          ? ({ status: "password-required" } as const)
          : opened();
      }),
    });
    await queue.add([file("locked.pdf"), file("b.pdf")]);
    expect(log).toEqual(["open s1", "open s2", "added b.pdf"]);
  });

  it("files added while running are opened by the running loop", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { log, queue } = setup({
      read: async (f) => {
        if (f.name === "a.pdf") await gate;
        return f.arrayBuffer();
      },
    });
    const first = queue.add([file("a.pdf")]);
    const second = queue.add([file("b.pdf")]);
    await second; // resolves at once: the first loop owns the work
    release();
    await first;
    expect(log.filter((l) => l.startsWith("added"))).toEqual([
      "added a.pdf",
      "added b.pdf",
    ]);
  });

  it("refuses files over the size limits before reading them", async () => {
    const { deps, log, queue } = setup();
    await queue.add([
      file("huge.pdf", 101),
      file("a.pdf", 100),
      file("b.pdf", 60),
    ]);
    expect(log).toEqual([
      "failed huge.pdf: It is over 100 B, too large to organize in the browser.",
      'open s1 ""',
      "added a.pdf",
      "failed b.pdf: Together with the files already open it would be over 150 B.",
    ]);
    expect(deps.read).toHaveBeenCalledTimes(1);
  });

  it("does not count refused files towards the total, and closes them", async () => {
    const { log, queue } = setup({
      onOpened: vi.fn((f) => {
        log.push(`offered ${f.name}`);
        return f.name !== "a.pdf";
      }),
    });
    await queue.add([file("a.pdf", 100), file("b.pdf", 100)]);
    expect(log).toEqual([
      'open s1 ""',
      "offered a.pdf",
      "close s1",
      'open s2 ""',
      "offered b.pdf",
    ]);
  });

  it("reports read failures and engine errors", async () => {
    const { log, queue } = setup({
      read: async (f) => {
        if (f.name === "gone.pdf") throw new Error("NotReadableError");
        return f.arrayBuffer();
      },
      open: async () => ({
        status: "error",
        reason: "failed",
        message: "Not a PDF.",
      }),
    });
    await queue.add([file("gone.pdf"), file("bad.pdf")]);
    expect(log).toEqual([
      "failed gone.pdf: The file could not be read.",
      "failed bad.pdf: Not a PDF.",
    ]);
  });

  it("cancel drops waiting files and ignores the answer in flight", async () => {
    let finish!: (r: OpenResult) => void;
    const { deps, log, queue } = setup({
      open: vi.fn(
        () => new Promise<OpenResult>((resolve) => (finish = resolve)),
      ),
    });
    const running = queue.add([file("a.pdf"), file("b.pdf")]);
    await vi.waitFor(() => expect(deps.open).toHaveBeenCalledTimes(1));
    queue.cancel();
    expect(queue.isBusy()).toBe(false);
    finish(opened());
    await running;
    expect(deps.onOpened).not.toHaveBeenCalled();
    expect(deps.open).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);
  });

  it("works again after a cancel, with the size total reset", async () => {
    const { log, queue } = setup();
    await queue.add([file("a.pdf", 100)]);
    queue.cancel();
    await queue.add([file("b.pdf", 100)]);
    expect(log.filter((l) => l.startsWith("added"))).toEqual([
      "added a.pdf",
      "added b.pdf",
    ]);
  });
});
