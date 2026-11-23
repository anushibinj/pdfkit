import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPRESS_OPTIONS } from "../core/options";
import {
  createCompressHandler,
  type CompressWorkerSession,
} from "./compress-handler";

function makeSession(overrides: Partial<CompressWorkerSession> = {}): CompressWorkerSession {
  return {
    compress: vi.fn(async (bytes) => ({
      kind: "compressed" as const,
      pdf: new Uint8Array([1, 2, 3]),
      pageCount: 2,
      originalBytes: bytes.length,
      compressedBytes: 3,
      report: {
        originalBytes: bytes.length,
        compressedBytes: 3,
        imagesInspected: 1,
        imagesReencoded: 1,
        imagesDownsampled: 0,
        imagesDeduplicated: 0,
        imagesSkippedLarger: 0,
        flateStreamsRecompressed: 1,
        objectsRemoved: 0,
        transparencyPreserved: 0,
        notes: [],
      },
      appliedConfig: {
        lossless: false,
        targetDpi: 150,
        quality: 0.75,
        grayscale: false,
      },
    })),
    renderPreview: vi.fn(() => ({
      pageIndex: 0,
      pageCount: 2,
      width: 10,
      height: 10,
      originalPixels: new Uint8Array(400),
      compressedPixels: new Uint8Array(400),
    })),
    ...overrides,
  };
}

describe("createCompressHandler", () => {
  const ctx = {
    progress: vi.fn(),
    signal: new AbortController().signal,
  };

  it("handles ping requests without initializing session", async () => {
    const getSession = vi.fn(async () => makeSession());
    const handler = createCompressHandler(getSession);
    const res = await handler({ op: "ping" }, ctx);
    expect(res.result).toEqual({ status: "pong" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("handles compress requests and transfers output buffer", async () => {
    const handler = createCompressHandler(async () => makeSession());
    const res = await handler(
      {
        op: "compress",
        data: new Uint8Array(100).buffer,
        filename: "doc.pdf",
        options: DEFAULT_COMPRESS_OPTIONS,
      },
      ctx,
    );
    expect(res.result.status).toBe("compressed");
    expect(res.transfer).toHaveLength(1);
  });

  it("handles preview requests and transfers both RGBA pixel buffers", async () => {
    const handler = createCompressHandler(async () => makeSession());
    const res = await handler(
      {
        op: "preview",
        originalData: new Uint8Array(10).buffer,
        compressedData: new Uint8Array(5).buffer,
        pageIndex: 0,
        width: 200,
      },
      ctx,
    );
    expect(res.result.status).toBe("preview-rendered");
    expect(res.transfer).toHaveLength(2);
  });

  it("maps out-of-memory errors cleanly", async () => {
    const handler = createCompressHandler(async () =>
      makeSession({
        compress: vi.fn(async () => {
          throw new RangeError("Out of memory");
        }),
      }),
    );
    const res = await handler(
      {
        op: "compress",
        data: new Uint8Array(10).buffer,
        filename: "huge.pdf",
        options: DEFAULT_COMPRESS_OPTIONS,
      },
      ctx,
    );
    expect(res.result).toMatchObject({
      status: "error",
      message: expect.stringMatching(/out of memory/i),
    });
  });
});
