import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPRESS_OPTIONS } from "./core/options";
import {
  WorkerCompressClient,
  type CompressRequestSender,
} from "./compress-client";

describe("WorkerCompressClient", () => {
  it("transfers buffers and forwards progress for compress and preview", async () => {
    const sender: CompressRequestSender = {
      request: vi.fn<CompressRequestSender["request"]>(async () => ({
        status: "pong",
      })),
      terminate: vi.fn(),
    };
    const client = new WorkerCompressClient(sender);
    const data = new Uint8Array([1, 2, 3]).buffer;
    const onProgress = vi.fn();

    await client.compress(data, "a.pdf", DEFAULT_COMPRESS_OPTIONS, "pw", onProgress);
    expect(sender.request).toHaveBeenCalledWith(
      {
        op: "compress",
        data,
        filename: "a.pdf",
        options: DEFAULT_COMPRESS_OPTIONS,
        password: "pw",
      },
      expect.objectContaining({ transfer: [data] }),
    );

    const orig = new Uint8Array([1]).buffer;
    const comp = new Uint8Array([2]).buffer;
    await client.renderPreview(orig, comp, 1, 600, "pw");
    expect(sender.request).toHaveBeenCalledWith(
      {
        op: "preview",
        originalData: orig,
        compressedData: comp,
        pageIndex: 1,
        width: 600,
        password: "pw",
      },
      { transfer: [orig, comp] },
    );

    client.terminate();
    expect(sender.terminate).toHaveBeenCalledTimes(1);
  });
});
