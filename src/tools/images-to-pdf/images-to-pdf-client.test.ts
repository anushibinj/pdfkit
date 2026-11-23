import { describe, expect, it, vi } from "vitest";
import type { WorkerLike } from "@/lib/worker-client";
import type { WorkerRequest, WorkerResponse } from "@/lib/worker-protocol";
import { DEFAULT_LAYOUT_OPTIONS } from "./core/options";
import { createWorkerImagesToPdfClient } from "./images-to-pdf-client";
import type { BuildPdfRequest, BuildPdfResult } from "./messages";

describe("createWorkerImagesToPdfClient", () => {
  it("transfers image buffers, forwards progress, and resolves worker result", async () => {
    let onMessage: ((e: MessageEvent<unknown>) => void) | undefined;
    const postMessage = vi.fn(
      (msg: WorkerRequest<BuildPdfRequest>) => {
        onMessage?.({
          data: {
            id: msg.id,
            type: "progress",
            progress: 0.5,
            stage: "Added image 1 of 2…",
          } satisfies WorkerResponse<BuildPdfResult>,
        } as MessageEvent<unknown>);
        onMessage?.({
          data: {
            id: msg.id,
            type: "result",
            payload: {
              status: "done",
              data: new Uint8Array([1, 2, 3]).buffer,
              pageCount: 1,
            },
          } satisfies WorkerResponse<BuildPdfResult>,
        } as MessageEvent<unknown>);
      },
    );
    const terminate = vi.fn();
    const fakeWorker: WorkerLike = {
      postMessage,
      addEventListener: (
        type: "message" | "error",
        listener:
          | ((e: MessageEvent<unknown>) => void)
          | ((e: ErrorEvent) => void),
      ) => {
        if (type === "message") {
          onMessage = listener as (e: MessageEvent<unknown>) => void;
        }
      },
      terminate,
    };

    const client = createWorkerImagesToPdfClient(() => fakeWorker);
    const buf = new Uint8Array([9, 8]).buffer;
    const onProgress = vi.fn();

    const result = await client.build(
      [{ data: buf, mime: "image/png", width: 10, height: 10, rotation: 0 }],
      DEFAULT_LAYOUT_OPTIONS,
      onProgress,
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ op: "build" }),
      }),
      [buf],
    );
    expect(onProgress).toHaveBeenCalledWith(0.5, "Added image 1 of 2…");
    expect(result.status).toBe("done");

    client.terminate();
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
