import { describe, expect, it, vi } from "vitest";
import { WorkerClient, WorkerError, type WorkerLike } from "./worker-client";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

class FakeWorker implements WorkerLike {
  sent: { message: WorkerRequest<unknown>; transfer: Transferable[] }[] = [];
  terminated = false;
  private messageListeners: ((e: MessageEvent<unknown>) => void)[] = [];
  private errorListeners: ((e: ErrorEvent) => void)[] = [];

  postMessage(message: unknown, transfer: Transferable[]) {
    this.sent.push({ message: message as WorkerRequest<unknown>, transfer });
  }
  addEventListener(type: string, listener: unknown) {
    if (type === "message") this.messageListeners.push(listener as never);
    else this.errorListeners.push(listener as never);
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg: WorkerResponse<unknown>) {
    for (const l of this.messageListeners) l({ data: msg } as MessageEvent<unknown>);
  }
  crash(message: string) {
    for (const l of this.errorListeners) l({ message } as ErrorEvent);
  }
}

function setup() {
  const worker = new FakeWorker();
  const factory = vi.fn(() => worker);
  const client = new WorkerClient<{ n: number }, { doubled: number }>(factory);
  return { worker, factory, client };
}

describe("WorkerClient", () => {
  it("creates the worker lazily, once", () => {
    const { factory, client } = setup();
    expect(factory).not.toHaveBeenCalled();
    void client.request({ n: 1 });
    void client.request({ n: 2 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("resolves a request with its result and forwards transfer lists", async () => {
    const { worker, client } = setup();
    const buf = new ArrayBuffer(8);
    const p = client.request({ n: 2 }, { transfer: [buf] });
    expect(worker.sent[0].transfer).toEqual([buf]);
    worker.reply({ id: worker.sent[0].message.id, type: "result", payload: { doubled: 4 } });
    await expect(p).resolves.toEqual({ doubled: 4 });
  });

  it("matches responses to requests by id, even out of order", async () => {
    const { worker, client } = setup();
    const a = client.request({ n: 1 });
    const b = client.request({ n: 2 });
    const [ma, mb] = worker.sent.map((s) => s.message.id);
    worker.reply({ id: mb, type: "result", payload: { doubled: 4 } });
    worker.reply({ id: ma, type: "result", payload: { doubled: 2 } });
    await expect(a).resolves.toEqual({ doubled: 2 });
    await expect(b).resolves.toEqual({ doubled: 4 });
  });

  it("rejects with a WorkerError when the worker reports an error", async () => {
    const { worker, client } = setup();
    const p = client.request({ n: 1 });
    worker.reply({
      id: worker.sent[0].message.id,
      type: "error",
      error: { name: "RangeError", message: "boom" },
    });
    await expect(p).rejects.toBeInstanceOf(WorkerError);
    await expect(p).rejects.toMatchObject({ name: "RangeError", message: "boom" });
  });

  it("delivers progress updates before the result", async () => {
    const { worker, client } = setup();
    const onProgress = vi.fn();
    const p = client.request({ n: 1 }, { onProgress });
    const id = worker.sent[0].message.id;
    worker.reply({ id, type: "progress", progress: 0.5, stage: "half" });
    worker.reply({ id, type: "result", payload: { doubled: 2 } });
    await p;
    expect(onProgress).toHaveBeenCalledWith(0.5, "half");
  });

  it("ignores responses for unknown ids", () => {
    const { worker, client } = setup();
    void client.request({ n: 1 });
    expect(() =>
      worker.reply({ id: 999, type: "result", payload: { doubled: 0 } }),
    ).not.toThrow();
  });

  it("rejects everything in flight on terminate() and refuses new work", async () => {
    const { worker, client } = setup();
    const p = client.request({ n: 1 });
    client.terminate();
    expect(worker.terminated).toBe(true);
    await expect(p).rejects.toThrow(/terminated/);
    await expect(client.request({ n: 2 })).rejects.toThrow(/terminated/);
    expect(() => client.terminate()).not.toThrow();
  });

  it("rejects pending requests when the worker crashes", async () => {
    const { worker, client } = setup();
    const p = client.request({ n: 1 });
    worker.crash("worker blew up");
    await expect(p).rejects.toThrow("worker blew up");
  });
});
