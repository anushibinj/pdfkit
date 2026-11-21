import { describe, expect, it, vi } from "vitest";
import { WorkerMergeClient, type MergeRequestSender } from "./merge-client";

function fakeSender(): MergeRequestSender {
  return {
    request: vi.fn(async () => ({
      status: "inspected" as const,
      pageCount: 1,
    })),
    terminate: vi.fn(),
  };
}

describe("WorkerMergeClient", () => {
  it("sends an inspect request and transfers the file's buffer", async () => {
    const sender = fakeSender();
    const data = new ArrayBuffer(4);
    const result = await new WorkerMergeClient(sender).inspect({
      data,
      password: "pw",
    });
    expect(result).toEqual({ status: "inspected", pageCount: 1 });
    expect(sender.request).toHaveBeenCalledWith(
      { op: "inspect", source: { data, password: "pw" } },
      { transfer: [data] },
    );
  });

  it("sends a merge request and transfers every buffer once", async () => {
    const sender = fakeSender();
    const a = new ArrayBuffer(1);
    const b = new ArrayBuffer(2);
    const sources = [{ data: a }, { data: b }, { data: a }];
    await new WorkerMergeClient(sender).merge(sources);
    expect(sender.request).toHaveBeenCalledWith(
      { op: "merge", sources },
      { transfer: [a, b] },
    );
  });

  it("terminates the worker", () => {
    const sender = fakeSender();
    new WorkerMergeClient(sender).terminate();
    expect(sender.terminate).toHaveBeenCalledOnce();
  });
});
