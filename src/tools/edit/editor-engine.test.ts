import { describe, expect, it, vi } from "vitest";
import {
  EditorEngine,
  createEditorWorkerClient,
  type EditorWorkerClient,
} from "./editor-engine";
import type { EditorRequest, EditorResult } from "./messages";

const page = {
  box: { left: 0, bottom: 0, right: 10, top: 10 },
  rotation: 0 as const,
};
const opened: EditorResult = { status: "opened", pages: [page] };
const rendered: EditorResult = {
  status: "rendered",
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4),
};

/**
 * Workers whose answers the test scripts: `respond` decides each result
 * (or throws to simulate a dead worker).
 */
function fakeWorkers(
  respond: (req: EditorRequest, worker: number) => EditorResult,
) {
  const workers: { requests: EditorRequest[]; terminated: boolean }[] = [];
  const factory = vi.fn((): EditorWorkerClient => {
    const n = workers.length;
    const w = { requests: [] as EditorRequest[], terminated: false };
    workers.push(w);
    return {
      request: vi.fn(async (req: EditorRequest) => {
        w.requests.push(req);
        return respond(req, n);
      }),
      terminate: () => {
        w.terminated = true;
      },
    };
  });
  return { factory, workers };
}

describe("createEditorWorkerClient", () => {
  it("creates a client lazily (no worker until the first request)", () => {
    const client = createEditorWorkerClient();
    expect(typeof client.request).toBe("function");
    client.terminate();
  });
});

describe("EditorEngine", () => {
  it("open transfers a copy and keeps the original", async () => {
    const { factory, workers } = fakeWorkers(() => opened);
    const engine = new EditorEngine(factory);
    const data = new Uint8Array([1, 2, 3]).buffer;
    expect(await engine.open(data, "pw")).toEqual(opened);
    const sent = workers[0].requests[0];
    expect(sent).toMatchObject({ op: "open", password: "pw" });
    if (sent.op !== "open") throw new Error("unreachable");
    expect(sent.data).not.toBe(data);
    expect(data.byteLength).toBe(3); // still usable
  });

  it("forwards render and save", async () => {
    const { factory, workers } = fakeWorkers((req) =>
      req.op === "render"
        ? rendered
        : req.op === "save"
          ? { status: "saved", data: new ArrayBuffer(1) }
          : opened,
    );
    const engine = new EditorEngine(factory);
    await engine.open(new ArrayBuffer(1));
    expect(await engine.render(0, 1, 300)).toEqual(rendered);
    const plan = { pages: [], images: [] };
    expect((await engine.save(plan)).status).toBe("saved");
    expect(workers[0].requests.map((r) => r.op)).toEqual([
      "open",
      "render",
      "save",
    ]);
    expect(workers[0].requests[1]).toEqual({
      op: "render",
      pageIndex: 0,
      rotation: 1,
      width: 300,
    });
  });

  it("runs requests one after another (enqueue)", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const factory = () => ({
      request: async (req: EditorRequest) => {
        order.push(`start ${req.op}`);
        if (req.op === "open") await new Promise<void>((r) => (release = r));
        order.push(`end ${req.op}`);
        return req.op === "open" ? opened : rendered;
      },
      terminate: () => {},
    });
    const engine = new EditorEngine(factory);
    const a = engine.open(new ArrayBuffer(1));
    const b = engine.render(0, 0, 10);
    await Promise.resolve();
    await Promise.resolve();
    release();
    await Promise.all([a, b]);
    expect(order).toEqual([
      "start open",
      "end open",
      "start render",
      "end render",
    ]);
  });

  it("restarts a crashed worker and silently reopens the file (send, reopenIfStale)", async () => {
    let crash = true;
    const { factory, workers } = fakeWorkers((req) => {
      if (req.op === "render" && crash) {
        crash = false;
        return { status: "error", reason: "crashed", message: "trap" };
      }
      return req.op === "open" ? opened : rendered;
    });
    const engine = new EditorEngine(factory);
    await engine.open(new ArrayBuffer(2), "pw");
    expect((await engine.render(0, 0, 10)).status).toBe("error");
    expect(workers[0].terminated).toBe(true);
    expect(await engine.render(0, 0, 10)).toEqual(rendered);
    expect(workers[1].requests.map((r) => r.op)).toEqual(["open", "render"]);
    expect(workers[1].requests[0]).toMatchObject({ password: "pw" });
  });

  it("treats a rejected request as a dead worker (send)", async () => {
    let die = true;
    const { factory, workers } = fakeWorkers((req) => {
      if (req.op === "save" && die) {
        die = false;
        throw new Error("The worker crashed");
      }
      return req.op === "open"
        ? opened
        : { status: "saved", data: new ArrayBuffer(1) };
    });
    const engine = new EditorEngine(factory);
    await engine.open(new ArrayBuffer(1));
    const failed = await engine.save({ pages: [], images: [] });
    expect(failed).toMatchObject({ status: "error", reason: "crashed" });
    expect(failed.status === "error" && failed.message).toContain(
      "The worker crashed",
    );
    expect((await engine.save({ pages: [], images: [] })).status).toBe("saved");
    expect(workers).toHaveLength(2);
  });

  it("keeps the worker after an ordinary failure", async () => {
    const { factory, workers } = fakeWorkers((req) =>
      req.op === "open"
        ? opened
        : { status: "error", reason: "failed", message: "no" },
    );
    const engine = new EditorEngine(factory);
    await engine.open(new ArrayBuffer(1));
    await engine.render(0, 0, 10);
    await engine.render(0, 0, 10);
    expect(workers).toHaveLength(1);
  });

  it("gives up on a file that cannot be reopened (reopenIfStale)", async () => {
    let worker0Crash = true;
    const { factory } = fakeWorkers((req, n) => {
      if (n === 0 && req.op === "render" && worker0Crash) {
        worker0Crash = false;
        return { status: "error", reason: "out-of-memory", message: "oom" };
      }
      if (n === 1 && req.op === "open")
        return { status: "error", reason: "failed", message: "gone" };
      return req.op === "open" ? opened : rendered;
    });
    const engine = new EditorEngine(factory);
    await engine.open(new ArrayBuffer(1));
    await engine.render(0, 0, 10);
    expect(await engine.render(0, 0, 10)).toMatchObject({ message: "gone" });
    // no longer tries to reopen: the request reaches the worker as is
    expect(await engine.render(0, 0, 10)).toEqual(rendered);
  });

  it("does not keep a file that failed to open", async () => {
    let crashOnce = true;
    const { factory, workers } = fakeWorkers((req) => {
      if (req.op === "open") return { status: "password-required" };
      if (crashOnce) {
        crashOnce = false;
        return { status: "error", reason: "crashed", message: "x" };
      }
      return rendered;
    });
    const engine = new EditorEngine(factory);
    await engine.open(new ArrayBuffer(1));
    await engine.render(0, 0, 10);
    await engine.render(0, 0, 10);
    // the second worker never received an "open"
    expect(workers[1].requests.map((r) => r.op)).toEqual(["render"]);
  });

  it("close tells the worker and forgets the file", async () => {
    const { factory, workers } = fakeWorkers((req) =>
      req.op === "close" ? { status: "closed" } : opened,
    );
    const engine = new EditorEngine(factory);
    await engine.close(); // nothing started yet: no worker needed
    expect(factory).not.toHaveBeenCalled();
    await engine.open(new ArrayBuffer(1));
    await engine.close();
    expect(workers[0].requests.map((r) => r.op)).toEqual(["open", "close"]);
  });

  it("dispose terminates the worker and refuses later requests", async () => {
    const { factory, workers } = fakeWorkers(() => opened);
    const engine = new EditorEngine(factory);
    await engine.open(new ArrayBuffer(1));
    engine.dispose();
    expect(workers[0].terminated).toBe(true);
    expect(await engine.render(0, 0, 1)).toMatchObject({
      message: "The editor was closed.",
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not restart when a request dies because of dispose", async () => {
    let reject: (e: Error) => void = () => {};
    const factory = vi.fn(() => ({
      request: () => new Promise<EditorResult>((_, r) => (reject = r)),
      terminate: () => reject(new Error("Worker has been terminated")),
    }));
    const engine = new EditorEngine(factory);
    const pending = engine.render(0, 0, 1);
    await Promise.resolve();
    await Promise.resolve();
    engine.dispose();
    expect(await pending).toMatchObject({ message: "The editor was closed." });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
