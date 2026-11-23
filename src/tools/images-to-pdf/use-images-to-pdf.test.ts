import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "@/lib/image-info";
import type { ImageListItem } from "./core/images-state";
import type { ImagesToPdfClient } from "./images-to-pdf-client";
import {
  CORRUPT_IMAGE_MESSAGE,
  ImageReadError,
  UNSUPPORTED_IMAGE_MESSAGE,
  describeBuildError,
  readImageInputs,
  useImagesToPdf,
  validateImageFile,
} from "./use-images-to-pdf";

/** Minimal valid PNG header (24 bytes: 8-byte signature + IHDR 32x16). */
function minimalPngBytes(width = 32, height = 16): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // length + "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes.buffer as ArrayBuffer;
}

describe("use-images-to-pdf helpers", () => {
  describe("validateImageFile", () => {
    it("accepts a valid PNG when decoder succeeds", async () => {
      const file = new File([minimalPngBytes(120, 80)], "ok.png", {
        type: "image/png",
      });
      const res = await validateImageFile(file, async () => ({
        close: vi.fn(),
      }));
      expect(res).toEqual({
        ok: true,
        info: { mime: "image/png", width: 120, height: 80 },
      });
    });

    it("rejects files over MAX_IMAGE_BYTES", async () => {
      const file = { size: MAX_IMAGE_BYTES + 1 } as File;
      const res = await validateImageFile(file);
      expect(res.ok).toBe(false);
    });

    it("rejects non-PNG/JPEG content", async () => {
      const file = new File(
        [new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer],
        "fake.png",
        {
          type: "image/png",
        },
      );
      const res = await validateImageFile(file);
      expect(res).toEqual({ ok: false, message: UNSUPPORTED_IMAGE_MESSAGE });
    });

    it("rejects valid header that fails browser decoding", async () => {
      const file = new File([minimalPngBytes()], "corrupt.png", {
        type: "image/png",
      });
      const res = await validateImageFile(file, async () => {
        throw new Error("decode failed");
      });
      expect(res).toEqual({ ok: false, message: CORRUPT_IMAGE_MESSAGE });
    });
  });

  describe("readImageInputs", () => {
    it("reads ready images in order and throws ImageReadError naming the first failure", async () => {
      const goodFile = new File([minimalPngBytes(10, 20)], "a.png", {
        type: "image/png",
      });
      const readyItem: ImageListItem = {
        id: "1",
        file: goodFile,
        rotation: 2,
        status: {
          kind: "ready",
          info: { mime: "image/png", width: 10, height: 20 },
        },
      };
      const inputs = await readImageInputs([readyItem]);
      expect(inputs).toHaveLength(1);
      expect(inputs[0].rotation).toBe(2);
      expect(inputs[0].width).toBe(10);

      const badItem: ImageListItem = {
        ...readyItem,
        id: "2",
        file: {
          arrayBuffer: () => Promise.reject(new Error("gone")),
        } as unknown as File,
      };
      await expect(readImageInputs([readyItem, badItem])).rejects.toMatchObject(
        {
          name: ImageReadError.name,
          index: 1,
        },
      );
    });
  });

  describe("describeBuildError", () => {
    it("prefixes the failing filename when imageIndex is present", () => {
      const items: ImageListItem[] = [
        {
          id: "1",
          file: new File([], "broken.jpg"),
          rotation: 0,
          status: { kind: "queued" },
        },
      ];
      expect(
        describeBuildError(
          {
            status: "error",
            reason: "invalid-image",
            message: "Corrupt",
            imageIndex: 0,
          },
          items,
        ),
      ).toBe("broken.jpg: Corrupt");
      expect(
        describeBuildError(
          { status: "error", reason: "failed", message: "Generic" },
          items,
        ),
      ).toBe("Generic");
    });
  });
});

describe("useImagesToPdf hook", () => {
  it("validates added files, builds a PDF, and restarts worker on WASM crash", async () => {
    const buildMock = vi
      .fn<ImagesToPdfClient["build"]>()
      .mockResolvedValueOnce({
        status: "error",
        reason: "crashed",
        message: "WASM trapped",
      })
      .mockResolvedValueOnce({
        status: "done",
        data: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
        pageCount: 1,
      });
    const terminateMock = vi.fn();
    const createClient = vi.fn<() => ImagesToPdfClient>(() => ({
      build: buildMock,
      terminate: terminateMock,
    }));

    const { result, unmount } = renderHook(() =>
      useImagesToPdf(createClient, async () => ({ close: vi.fn() })),
    );

    act(() => {
      result.current.add([
        new File([minimalPngBytes(40, 30)], "photo.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() =>
      expect(result.current.state.items[0]?.status.kind).toBe("ready"),
    );

    // First build crashes -> worker is terminated and recreated.
    act(() => {
      result.current.build();
    });
    await waitFor(() =>
      expect(result.current.state.outcome.kind).toBe("error"),
    );
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(terminateMock).toHaveBeenCalledTimes(1);

    // Second build succeeds.
    act(() => {
      result.current.build();
    });
    await waitFor(() =>
      expect(result.current.state.outcome.kind).toBe("done"),
    );

    unmount();
    expect(terminateMock).toHaveBeenCalledTimes(2);
  });
});
