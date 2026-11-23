import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompressClient } from "./compress-client";
import { useCompressPdf } from "./use-compress-pdf";

function makeFakeClient(overrides: Partial<CompressClient> = {}): CompressClient {
  return {
    compress: vi.fn(async (data) => ({
      status: "compressed" as const,
      data: new Uint8Array([1, 2, 3]).buffer,
      pageCount: 2,
      originalBytes: data.byteLength,
      compressedBytes: 3,
      report: {
        originalBytes: data.byteLength,
        compressedBytes: 3,
        imagesInspected: 1,
        imagesReencoded: 1,
        imagesDownsampled: 0,
        imagesDeduplicated: 0,
        imagesSkippedLarger: 0,
        flateStreamsRecompressed: 0,
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
    renderPreview: vi.fn(async () => ({
      status: "preview-rendered" as const,
      pageIndex: 0,
      pageCount: 2,
      width: 20,
      height: 30,
      originalPixels: new Uint8Array(20 * 30 * 4).buffer,
      compressedPixels: new Uint8Array(20 * 30 * 4).buffer,
    })),
    terminate: vi.fn(),
    ...overrides,
  };
}

describe("useCompressPdf", () => {
  it("batches multiple files and opens side-by-side preview", async () => {
    const client = makeFakeClient();
    const { result } = renderHook(() => useCompressPdf(() => client));

    const f1 = new File([new Uint8Array(100)], "one.pdf", {
      type: "application/pdf",
    });
    const f2 = new File([new Uint8Array(200)], "two.pdf", {
      type: "application/pdf",
    });

    act(() => result.current.addFiles([f1, f2]));
    expect(result.current.state.items).toHaveLength(2);

    await act(async () => {
      await result.current.compressAll();
    });

    expect(result.current.state.items[0].status.kind).toBe("compressed");
    expect(result.current.state.items[1].status.kind).toBe("compressed");

    const id = result.current.state.items[0].id;
    await act(async () => {
      await result.current.openPreview(id, 0, 400);
    });
    expect(result.current.state.preview?.loading).toBe(false);
    expect(result.current.state.preview?.width).toBe(20);
  });

  it("handles password prompt submission", async () => {
    const compress = vi
      .fn()
      .mockResolvedValueOnce({
        status: "password-required",
        wrongPassword: false,
      })
      .mockResolvedValueOnce({
        status: "compressed",
        data: new Uint8Array([1, 2]).buffer,
        pageCount: 1,
        originalBytes: 50,
        compressedBytes: 2,
        report: {
          originalBytes: 50,
          compressedBytes: 2,
          imagesInspected: 0,
          imagesReencoded: 0,
          imagesDownsampled: 0,
          imagesDeduplicated: 0,
          imagesSkippedLarger: 0,
          flateStreamsRecompressed: 0,
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
      });
    const client = makeFakeClient({ compress });
    const { result } = renderHook(() => useCompressPdf(() => client));

    act(() =>
      result.current.addFiles([
        new File([new Uint8Array(50)], "locked.pdf", {
          type: "application/pdf",
        }),
      ]),
    );
    await act(async () => {
      await result.current.compressAll();
    });
    expect(result.current.state.items[0].status.kind).toBe("password-required");

    await act(async () => {
      await result.current.submitPassword(
        result.current.state.items[0].id,
        "hunter2",
      );
    });
    expect(result.current.state.items[0].status.kind).toBe("compressed");
  });
});
