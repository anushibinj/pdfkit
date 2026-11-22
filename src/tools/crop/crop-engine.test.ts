import { describe, expect, it, vi } from "vitest";
import { CANCELLED, CropEngine, type CropWorkerClient } from "./crop-engine";
import type { CropRequest, CropWorkerResult } from "./messages";

const opened: CropWorkerResult = {
  status: "opened",
  pages: [{ box: { left: 0, bottom: 0, right: 10, top: 10 }, rotation: 0 }],
};
const rendered: CropWorkerResult = {
  status: "rendered",
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4),
};
const plan = { removeOutside: false, pages: [] };

/** A fake worker client answering with `respond`; every client is logged. */
function fakeClients(
  respond: (request: CropRequest, n: number) => Promise<CropWorkerResult>,
) {
  const clients: (CropWorkerClient & { requests: CropRequest[] })[] = [];
  let n = 0;
  const create = () => {
    const requests: CropRequest[] = [];
    const client = {
      requests,
      request: vi.fn(
        async (
          payload: CropRequest,
          options?: { onProgress?: (p: number, s?: string) => void },
        ) => {
          requests.push(payload);
          options?.onProgress?.(0.5, "checking");
          return respond(payload, n++);
        },
      ),
      terminate: vi.fn(),
    };
    clients.push(client);
    return client;
  };
  return { create, clients };
}

describe("CropEngine", () => {
  it("opens with a transferred copy and keeps the original", async () => {
    const { create, clients } = fakeClients(async () => opened);
    const engine = new CropEngine(create);
    const data = Uint8Array.of(1, 2).buffer;
    expect(await engine.open(data)).toEqual(opened);
    const sent = clients[0].requests[0] as { data: ArrayBuffer };
    expect(sent.data).not.toBe(data);
    expect(data.byteLength).toBe(2);
  });

  it("skips renders aborted while queued", async () => {
    const { create } = fakeClients(async (r) =>
      r.op === "render" ? rendered : opened,
    );
    const engine = new CropEngine(create);
    const controller = new AbortController();
    controller.abort();
    expect(await engine.render(0, 100, controller.signal)).toBe(CANCELLED);
    expect(await engine.render(0, 100)).toEqual(rendered);
  });

  it("reports crop progress by stage", async () => {
    const { create } = fakeClients(async () => ({
      status: "check-failed",
      pageIndex: 0,
      message: "m",
    }));
    const engine = new CropEngine(create);
    const progress = vi.fn();
    expect((await engine.crop(plan, progress)).status).toBe("check-failed");
    expect(progress).toHaveBeenCalledWith("checking", 0.5);
  });

  it("replaces a crashed worker and reopens the file before the next request", async () => {
    const { create, clients } = fakeClients(async (r, n) => {
      if (r.op === "open") return opened;
      if (n === 1) throw new Error("worker died");
      return rendered;
    });
    const engine = new CropEngine(create);
    await engine.open(new ArrayBuffer(3));
    const crashed = await engine.render(0, 10);
    expect(crashed).toMatchObject({ status: "error", reason: "crashed" });
    expect(clients[0].terminate).toHaveBeenCalled();
    expect(await engine.render(0, 10)).toEqual(rendered);
    expect(clients[1].requests.map((r) => r.op)).toEqual(["open", "render"]);
  });

  it("replaces the worker after an out-of-memory result", async () => {
    const { create, clients } = fakeClients(async (r) =>
      r.op === "open"
        ? opened
        : { status: "error", reason: "out-of-memory", message: "full" },
    );
    const engine = new CropEngine(create);
    await engine.open(new ArrayBuffer(1));
    await engine.crop(plan);
    expect(clients[0].terminate).toHaveBeenCalled();
  });

  it("gives up re-opening when the file no longer opens", async () => {
    let fail = false;
    const { create } = fakeClients(async (r) => {
      if (r.op === "open")
        return fail ? { status: "encrypted", message: "x" } : opened;
      throw new Error("died");
    });
    const engine = new CropEngine(create);
    await engine.open(new ArrayBuffer(1));
    await engine.render(0, 1);
    fail = true;
    expect(await engine.render(0, 1)).toMatchObject({
      message: "Could not reopen the PDF. Open it again.",
    });
  });

  it("closes the file, and answers every request after dispose", async () => {
    const { create, clients } = fakeClients(async (r) =>
      r.op === "close" ? { status: "closed" } : opened,
    );
    const engine = new CropEngine(create);
    await engine.close(); // no worker yet: nothing to send
    await engine.open(new ArrayBuffer(1));
    await engine.close();
    expect(clients[0].requests.map((r) => r.op)).toEqual(["open", "close"]);
    engine.dispose();
    expect(clients[0].terminate).toHaveBeenCalled();
    expect(await engine.render(0, 1)).toMatchObject({
      message: "The cropper was closed.",
    });
  });
});
