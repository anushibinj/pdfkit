import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./core/model";
import type { WatermarkRequest, WatermarkResult } from "./messages";
import {
  PREVIEW_CANCELLED,
  WatermarkEngine,
  createWatermarkWorkerClient,
  type WatermarkWorkerClient,
} from "./watermark-engine";

function setup(answer: (payload: WatermarkRequest) => WatermarkResult) {
  const sent: WatermarkRequest[] = [];
  const client: WatermarkWorkerClient = {
    request: vi.fn(async (payload: WatermarkRequest) => {
      sent.push(payload);
      return answer(payload);
    }),
    terminate: vi.fn(),
  };
  return { engine: new WatermarkEngine(() => client), sent, client };
}

describe("createWatermarkWorkerClient", () => {
  it("creates a client lazily (no worker until the first request)", () => {
    const create = vi.fn();
    vi.stubGlobal("Worker", create);
    const client = createWatermarkWorkerClient();
    expect(create).not.toHaveBeenCalled();
    client.terminate();
    vi.unstubAllGlobals();
  });
});

describe("WatermarkEngine", () => {
  it("opens with the password and reports the page count", async () => {
    const { engine, sent } = setup(() => ({ status: "opened", pageCount: 3 }));
    expect(await engine.open(new ArrayBuffer(2), "pw")).toEqual({
      status: "opened",
      pageCount: 3,
    });
    expect(sent[0]).toMatchObject({ op: "open", password: "pw" });
  });

  it("sends previews and applies", async () => {
    const { engine, sent } = setup((p) =>
      p.op === "preview"
        ? {
            status: "rendered",
            width: 1,
            height: 1,
            pixels: new ArrayBuffer(4),
          }
        : { status: "watermarked", data: new ArrayBuffer(1) },
    );
    await engine.preview(2, 300, DEFAULT_SETTINGS);
    await engine.apply(DEFAULT_SETTINGS, [0, 2]);
    expect(sent).toEqual([
      { op: "preview", pageIndex: 2, width: 300, settings: DEFAULT_SETTINGS },
      { op: "apply", settings: DEFAULT_SETTINGS, pages: [0, 2] },
    ]);
  });

  it("skips a preview whose signal was aborted before it ran", async () => {
    const { engine, sent } = setup(() => ({ status: "closed" }));
    const controller = new AbortController();
    controller.abort();
    expect(await engine.preview(0, 10, undefined, controller.signal)).toBe(
      PREVIEW_CANCELLED,
    );
    expect(sent).toEqual([]);
  });

  it("closes the file and disposes the worker", async () => {
    const { engine, sent, client } = setup(() => ({ status: "closed" }));
    await engine.preview(0, 10, undefined); // starts the worker
    await engine.close();
    expect(sent.at(-1)).toEqual({ op: "close" });
    engine.dispose();
    expect(client.terminate).toHaveBeenCalled();
    expect(await engine.apply(DEFAULT_SETTINGS, [0])).toMatchObject({
      status: "error",
      message: "The watermark tool was closed.",
    });
  });
});
