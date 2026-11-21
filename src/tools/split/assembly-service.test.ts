import { describe, expect, it, vi } from "vitest";
import { AssemblyService, CANCELLED, type AssembleWorkerClient } from "./assembly-service";
import type { AssembleRequest, AssembleResult } from "./messages";

const done: AssembleResult = { status: "assembled", files: [] };

/**
 * A worker client whose requests wait until answered or terminated, like
 * the real one (terminate rejects what is pending).
 */
function pendingClient() {
  let answer: (r: AssembleResult) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const client = {
    request: vi.fn(
      (_payload: AssembleRequest, options?: { onProgress?: (p: number) => void }) =>
        new Promise<AssembleResult>((resolve, reject) => {
          options?.onProgress?.(0.5);
          answer = resolve;
          fail = reject;
        }),
    ),
    terminate: vi.fn(() => fail(new Error("Worker has been terminated"))),
  };
  return {
    client: client as AssembleWorkerClient & typeof client,
    answer: (r: AssembleResult) => answer(r),
    die: (e: Error) => fail(e),
  };
}

describe("AssemblyService", () => {
  it("sends a transferred copy of the file with the plan and reports progress", async () => {
    const fake = pendingClient();
    const service = new AssemblyService(() => fake.client);
    const data = new Uint8Array([1, 2]).buffer;
    const progress = vi.fn();
    const run = service.assemble(data, "pw", 2, [[0], [1]], progress);
    fake.answer(done);
    expect(await run).toBe(done);
    const [payload, options] = fake.client.request.mock.calls[0];
    expect(payload).toMatchObject({ password: "pw", pageCount: 2, outputs: [[0], [1]] });
    expect(payload.data).not.toBe(data);
    expect(options).toMatchObject({ transfer: [payload.data] });
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(data.byteLength).toBe(2);
  });

  it("reuses the worker between successful runs", async () => {
    const fake = pendingClient();
    const factory = vi.fn(() => fake.client);
    const service = new AssemblyService(factory);
    const first = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    fake.answer(done);
    await first;
    const second = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    fake.answer(done);
    await second;
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("cancel stops the worker and the run reports Cancelled", async () => {
    const fakes = [pendingClient(), pendingClient()];
    let made = 0;
    const service = new AssemblyService(() => fakes[made++].client);
    const run = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    service.cancel();
    expect(await run).toBe(CANCELLED);
    expect(fakes[0].client.terminate).toHaveBeenCalled();
    // the next run gets a new worker
    const next = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    fakes[1].answer(done);
    expect(await next).toBe(done);
    expect(made).toBe(2);
  });

  it("cancel without a run does nothing", () => {
    const factory = vi.fn();
    new AssemblyService(factory).cancel();
    expect(factory).not.toHaveBeenCalled();
  });

  it("replaces a worker that died and reports a crash", async () => {
    const fakes = [pendingClient(), pendingClient()];
    let made = 0;
    const service = new AssemblyService(() => fakes[made++].client);
    const run = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    fakes[0].die(new Error("out of memory"));
    expect(await run).toMatchObject({
      status: "error",
      reason: "crashed",
      message: expect.stringContaining("out of memory"),
    });
    const next = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    fakes[1].answer(done);
    await next;
    expect(made).toBe(2);
  });

  it("replaces the worker after a crashed result, not after an ordinary failure", async () => {
    const fake = pendingClient();
    const service = new AssemblyService(() => fake.client);
    let run = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    fake.answer({ status: "error", reason: "failed", message: "bad page" });
    await run;
    expect(fake.client.terminate).not.toHaveBeenCalled();
    run = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    fake.answer({ status: "error", reason: "out-of-memory", message: "oom" });
    await run;
    expect(fake.client.terminate).toHaveBeenCalled();
  });

  it("dispose stops the run and refuses later ones", async () => {
    const fake = pendingClient();
    const service = new AssemblyService(() => fake.client);
    const run = service.assemble(new ArrayBuffer(1), "", 1, [[0]]);
    service.dispose();
    expect(await run).toBe(CANCELLED);
    expect(await service.assemble(new ArrayBuffer(1), "", 1, [[0]])).toMatchObject({
      message: "The tool was closed.",
    });
  });
});
