import { describe, expect, it, vi } from "vitest";
import type { OrganizeRequest, OrganizeResult } from "./messages";
import {
  CANCELLED,
  OrganizeEngine,
  createOrganizeWorkerClient,
  type OrganizeWorkerClient,
} from "./organize-engine";

const page = {
  box: { left: 0, bottom: 0, right: 10, top: 10 },
  rotation: 0 as const,
};
const opened: OrganizeResult = { status: "opened", pages: [page] };
const rendered: OrganizeResult = {
  status: "rendered",
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4),
};
const saved: OrganizeResult = { status: "saved", data: new ArrayBuffer(2) };

/**
 * Workers whose answers the test scripts: `respond` decides each result
 * (or throws to simulate a dead worker).
 */
function fakeWorkers(
  respond: (req: OrganizeRequest, worker: number) => OrganizeResult,
) {
  const workers: { requests: OrganizeRequest[]; terminated: boolean }[] = [];
  const factory = vi.fn((): OrganizeWorkerClient => {
    const n = workers.length;
    const w = { requests: [] as OrganizeRequest[], terminated: false };
    workers.push(w);
    return {
      request: vi.fn(async (req: OrganizeRequest) => {
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

/** A default responder: every request succeeds. */
const ok = (req: OrganizeRequest): OrganizeResult =>
  req.op === "open"
    ? opened
    : req.op === "render"
      ? rendered
      : req.op === "save"
        ? saved
        : { status: "closed" };

describe("createOrganizeWorkerClient", () => {
  it("creates a client lazily (no worker until the first request)", () => {
    const client = createOrganizeWorkerClient();
    expect(typeof client.request).toBe("function");
    client.terminate();
  });
});

describe("OrganizeEngine", () => {
  it("open transfers a copy under the file's id and keeps the original", async () => {
    const { factory, workers } = fakeWorkers(ok);
    const engine = new OrganizeEngine(factory);
    const data = new Uint8Array([1, 2, 3]).buffer;
    expect(await engine.open("s1", data, "pw")).toEqual(opened);
    const req = workers[0].requests[0];
    expect(req).toMatchObject({ op: "open", sourceId: "s1", password: "pw" });
    expect((req as { data: ArrayBuffer }).data).not.toBe(data);
    expect(data.byteLength).toBe(3); // not detached
  });

  it("renders and saves through the worker", async () => {
    const { factory, workers } = fakeWorkers(ok);
    const engine = new OrganizeEngine(factory);
    expect(await engine.render("s1", 2, 1, 300)).toEqual(rendered);
    const pages = [
      { kind: "blank" as const, width: 1, height: 1, rotation: 0 as const },
    ];
    expect(await engine.save(pages)).toEqual(saved);
    expect(workers[0].requests).toEqual([
      { op: "render", sourceId: "s1", pageIndex: 2, rotation: 1, width: 300 },
      { op: "save", pages },
    ]);
  });

  it("skips a render whose signal was aborted while it waited", async () => {
    const { factory, workers } = fakeWorkers(ok);
    const engine = new OrganizeEngine(factory);
    const controller = new AbortController();
    const first = engine.open("s1", new ArrayBuffer(1));
    const second = engine.render("s1", 0, 0, 10, controller.signal);
    controller.abort();
    await first;
    expect(await second).toBe(CANCELLED);
    expect(workers[0].requests.map((r) => r.op)).toEqual(["open"]);
  });

  it("re-opens every file, in order, after the worker crashes", async () => {
    let crash = true;
    const { factory, workers } = fakeWorkers((req) => {
      if (req.op === "render" && crash) {
        crash = false;
        throw new Error("boom");
      }
      return ok(req);
    });
    const engine = new OrganizeEngine(factory);
    await engine.open("a", new ArrayBuffer(1), "pa");
    await engine.open("b", new ArrayBuffer(2), "");
    const failed = await engine.render("a", 0, 0, 10);
    expect(failed).toMatchObject({ status: "error", reason: "crashed" });
    expect(workers[0].terminated).toBe(true);
    expect(await engine.render("b", 0, 0, 10)).toEqual(rendered);
    expect(
      workers[1].requests.map((r) =>
        r.op === "open" ? `open ${r.sourceId} ${r.password}` : r.op,
      ),
    ).toEqual(["open a pa", "open b ", "render"]);
  });

  it("replaces the worker after an out-of-memory result too", async () => {
    let first = true;
    const { factory, workers } = fakeWorkers((req) => {
      if (req.op === "save" && first) {
        first = false;
        return { status: "error", reason: "out-of-memory", message: "oom" };
      }
      return ok(req);
    });
    const engine = new OrganizeEngine(factory);
    await engine.open("a", new ArrayBuffer(1));
    expect(await engine.save([])).toMatchObject({ reason: "out-of-memory" });
    expect(await engine.save([])).toEqual(saved);
    expect(workers).toHaveLength(2);
  });

  it("an ordinary failure keeps the worker", async () => {
    const { factory, workers } = fakeWorkers(() => ({
      status: "error",
      reason: "failed",
      message: "nope",
    }));
    const engine = new OrganizeEngine(factory);
    await engine.render("a", 0, 0, 1);
    await engine.render("a", 0, 0, 1);
    expect(workers).toHaveLength(1);
  });

  it("drops the kept files when re-opening fails, so it does not loop", async () => {
    let worker0 = true;
    const { factory, workers } = fakeWorkers((req, n) => {
      if (n === 0 && req.op === "render" && worker0) {
        worker0 = false;
        throw new Error("boom");
      }
      if (n === 1 && req.op === "open")
        return { status: "error", reason: "failed", message: "corrupt" };
      return ok(req);
    });
    const engine = new OrganizeEngine(factory);
    await engine.open("a", new ArrayBuffer(1));
    await engine.render("a", 0, 0, 1); // crashes
    expect(await engine.render("a", 0, 0, 1)).toMatchObject({
      message: "corrupt",
    });
    // No further re-open attempt: the render goes straight through.
    await engine.render("a", 0, 0, 1);
    expect(workers[1].requests.map((r) => r.op)).toEqual(["open", "render"]);
  });

  it("does not keep a file that failed to open", async () => {
    let crash = true;
    const { factory, workers } = fakeWorkers((req) => {
      if (req.op === "open") return { status: "password-required" };
      if (req.op === "render" && crash) {
        crash = false;
        throw new Error("boom");
      }
      return ok(req);
    });
    const engine = new OrganizeEngine(factory);
    await engine.open("a", new ArrayBuffer(1));
    await engine.render("a", 0, 0, 1);
    await engine.render("a", 0, 0, 1);
    expect(workers[1].requests.map((r) => r.op)).toEqual(["render"]);
  });

  it("close forgets one file or all, and tells the worker", async () => {
    let crash = true;
    const { factory, workers } = fakeWorkers((req) => {
      if (req.op === "render" && crash) {
        crash = false;
        throw new Error("boom");
      }
      return ok(req);
    });
    const engine = new OrganizeEngine(factory);
    await engine.open("a", new ArrayBuffer(1));
    await engine.open("b", new ArrayBuffer(1));
    await engine.close("a");
    expect(workers[0].requests.at(-1)).toEqual({ op: "close", sourceId: "a" });
    await engine.render("b", 0, 0, 1); // crash: only b is re-opened
    await engine.render("b", 0, 0, 1);
    expect(
      workers[1].requests
        .filter((r) => r.op === "open")
        .map((r) => (r as { sourceId: string }).sourceId),
    ).toEqual(["b"]);
    await engine.close();
    expect(workers[1].requests.at(-1)).toEqual({
      op: "close",
      sourceId: undefined,
    });
  });

  it("close without a worker does not start one", async () => {
    const { factory } = fakeWorkers(ok);
    await new OrganizeEngine(factory).close();
    expect(factory).not.toHaveBeenCalled();
  });

  it("answers every request with an error after dispose", async () => {
    const { factory, workers } = fakeWorkers(ok);
    const engine = new OrganizeEngine(factory);
    await engine.open("a", new ArrayBuffer(1));
    engine.dispose();
    expect(workers[0].terminated).toBe(true);
    expect(await engine.render("a", 0, 0, 1)).toMatchObject({
      status: "error",
      message: "The organizer was closed.",
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
