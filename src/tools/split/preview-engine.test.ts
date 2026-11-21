import { describe, expect, it, vi } from "vitest";
import type { PreviewRequest, PreviewResult } from "./messages";
import { CANCELLED, PreviewEngine, type PreviewWorkerClient } from "./preview-engine";

const opened: PreviewResult = { status: "opened", pages: [{ width: 1, height: 1 }] };
const rendered: PreviewResult = {
  status: "rendered",
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4),
};

/** A worker client answering with `respond`; records every request. */
function fakeClient(respond: (req: PreviewRequest) => PreviewResult | Promise<PreviewResult>) {
  const requests: PreviewRequest[] = [];
  const client = {
    request: vi.fn<PreviewWorkerClient["request"]>(async (req) => {
      requests.push(req);
      return respond(req);
    }),
    terminate: vi.fn<PreviewWorkerClient["terminate"]>(),
  };
  return { client, requests };
}

const ok = (req: PreviewRequest): PreviewResult =>
  req.op === "open" ? opened : req.op === "render" ? rendered : { status: "closed" };

describe("PreviewEngine", () => {
  it("opens with a transferred copy and keeps the original", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    const data = new Uint8Array([1, 2, 3]).buffer;
    expect(await engine.open(data, "pw")).toEqual(opened);
    const sent = requests[0] as Extract<PreviewRequest, { op: "open" }>;
    expect(sent.data).not.toBe(data);
    expect(sent.password).toBe("pw");
    expect(vi.mocked(client.request).mock.calls[0][1]).toEqual({
      transfer: [sent.data],
    });
    expect(data.byteLength).toBe(3);
  });

  it("renders a page", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    await engine.open(new ArrayBuffer(1));
    expect(await engine.render(2, 150)).toEqual(rendered);
    expect(requests[1]).toEqual({ op: "render", pageIndex: 2, width: 150 });
  });

  it("skips a render aborted while it waited", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    const controller = new AbortController();
    const pending = engine.render(0, 100, controller.signal);
    controller.abort();
    expect(await pending).toBe(CANCELLED);
    expect(requests).toHaveLength(0);
  });

  it("runs requests one after another", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { client } = fakeClient(async (req) => {
      order.push(`start ${req.op}`);
      if (req.op === "open") await gate;
      order.push(`end ${req.op}`);
      return ok(req);
    });
    const engine = new PreviewEngine(() => client);
    const a = engine.open(new ArrayBuffer(1));
    const b = engine.render(0, 10);
    await Promise.resolve();
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["start open", "end open", "start render", "end render"]);
  });

  it("restarts a crashed worker and reopens the file before the next render", async () => {
    let crash = true;
    const clients: ReturnType<typeof fakeClient>[] = [];
    const engine = new PreviewEngine(() => {
      const made = fakeClient((req) => {
        if (req.op === "render" && crash) {
          crash = false;
          return { status: "error", reason: "crashed", message: "trap" };
        }
        return ok(req);
      });
      clients.push(made);
      return made.client;
    });
    await engine.open(new Uint8Array([7]).buffer, "pw");
    expect(await engine.render(0, 10)).toMatchObject({ reason: "crashed" });
    expect(clients[0].client.terminate).toHaveBeenCalled();
    expect(await engine.render(0, 10)).toEqual(rendered);
    expect(clients).toHaveLength(2);
    const reopen = clients[1].requests[0] as Extract<PreviewRequest, { op: "open" }>;
    expect(reopen.op).toBe("open");
    expect(reopen.password).toBe("pw");
    expect(Array.from(new Uint8Array(reopen.data))).toEqual([7]);
  });

  it("treats a dead worker (rejected request) as a crash", async () => {
    let calls = 0;
    const engine = new PreviewEngine(
      () =>
        fakeClient((req) => {
          calls++;
          if (calls === 2) throw new Error("worker died");
          return ok(req);
        }).client,
    );
    await engine.open(new ArrayBuffer(1));
    expect(await engine.render(0, 10)).toMatchObject({
      reason: "crashed",
      message: expect.stringContaining("worker died"),
    });
    expect(await engine.render(0, 10)).toEqual(rendered);
  });

  it("gives up on a file that cannot be reopened", async () => {
    let phase = 0;
    const engine = new PreviewEngine(
      () =>
        fakeClient((req) => {
          if (req.op === "render" && phase === 0) {
            phase = 1;
            return { status: "error", reason: "out-of-memory", message: "oom" };
          }
          if (req.op === "open" && phase === 1) return { status: "wrong-password" };
          return ok(req);
        }).client,
    );
    await engine.open(new ArrayBuffer(1));
    await engine.render(0, 10);
    expect(await engine.render(0, 10)).toMatchObject({
      message: "Could not reopen the PDF. Open it again.",
    });
  });

  it("close forgets the file; dispose stops the worker for good", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    expect(await engine.close()).toEqual({ status: "closed" });
    expect(requests).toHaveLength(0); // no worker started just to close
    await engine.open(new ArrayBuffer(1));
    expect(await engine.close()).toEqual({ status: "closed" });
    expect(requests.at(-1)).toEqual({ op: "close" });
    engine.dispose();
    expect(client.terminate).toHaveBeenCalled();
    expect(await engine.render(0, 1)).toMatchObject({ message: "The tool was closed." });
  });
});
