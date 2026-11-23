import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT_OPTIONS } from "../core/options";
import { InvalidImageError } from "../engine/image-embedder";
import type { PdfFromImagesEngine } from "../engine/pdf-builder";
import type { BuildPdfRequest } from "../messages";
import {
  createImagesToPdfHandler,
  handleBuildRequest,
  toErrorResult,
  toImageSource,
} from "./images-to-pdf-handler";

describe("images-to-pdf-handler", () => {
  describe("toErrorResult", () => {
    it("classifies InvalidImageError with imageIndex", () => {
      expect(toErrorResult(new InvalidImageError("Bad JPEG", 2))).toEqual({
        status: "error",
        reason: "invalid-image",
        message: "Bad JPEG",
        imageIndex: 2,
      });
    });

    it("classifies RangeError as out-of-memory", () => {
      const res = toErrorResult(new RangeError("Array buffer allocation failed"));
      expect(res.reason).toBe("out-of-memory");
    });

    it("classifies WebAssembly.RuntimeError as crashed", () => {
      const res = toErrorResult(new WebAssembly.RuntimeError("unreachable"));
      expect(res.reason).toBe("crashed");
      expect(res.message).toContain("unreachable");
    });

    it("classifies generic errors as failed", () => {
      expect(toErrorResult(new Error("boom"))).toEqual({
        status: "error",
        reason: "failed",
        message: "boom",
      });
    });
  });

  describe("toImageSource", () => {
    it("preserves valid rotations and defaults invalid rotations to 0", () => {
      const buf = new Uint8Array([1, 2]).buffer;
      expect(
        toImageSource({
          data: buf,
          mime: "image/png",
          width: 10,
          height: 20,
          rotation: 3,
        }),
      ).toEqual({
        bytes: new Uint8Array([1, 2]),
        mime: "image/png",
        width: 10,
        height: 20,
        rotation: 3,
      });

      expect(
        toImageSource({
          data: buf,
          mime: "image/jpeg",
          width: 10,
          height: 20,
          rotation: 99 as never,
        }).rotation,
      ).toBe(0);
    });
  });

  describe("handleBuildRequest", () => {
    it("returns transferred PDF buffer and forwards progress", () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const engine: PdfFromImagesEngine = {
        build: vi.fn((_imgs, _opts, onProgress) => {
          onProgress?.(0.5, "Halfway");
          return { bytes: pdfBytes, pageCount: 1 };
        }),
      };
      const progress = vi.fn();
      const request: BuildPdfRequest = {
        op: "build",
        images: [
          {
            data: new Uint8Array([1]).buffer,
            mime: "image/png",
            width: 100,
            height: 100,
            rotation: 0,
          },
        ],
        options: DEFAULT_LAYOUT_OPTIONS,
      };

      const { result, transfer } = handleBuildRequest(engine, request, {
        progress,
      });

      expect(result.status).toBe("done");
      if (result.status === "done") {
        expect(result.pageCount).toBe(1);
        expect(new Uint8Array(result.data)).toEqual(pdfBytes);
        expect(transfer).toEqual([result.data]);
      }
      expect(progress).toHaveBeenCalledWith(0.5, "Halfway");
    });

    it("returns classified error result when engine throws", () => {
      const engine: PdfFromImagesEngine = {
        build: vi.fn(() => {
          throw new InvalidImageError("Corrupt", 0);
        }),
      };
      const { result } = handleBuildRequest(
        engine,
        { op: "build", images: [], options: DEFAULT_LAYOUT_OPTIONS },
        { progress: vi.fn() },
      );
      expect(result).toEqual({
        status: "error",
        reason: "invalid-image",
        message: "Corrupt",
        imageIndex: 0,
      });
    });
  });

  describe("createImagesToPdfHandler", () => {
    it("lazily resolves engine and catches engine-load failures", async () => {
      const failingHandler = createImagesToPdfHandler(async () => {
        throw new Error("WASM load failed");
      });
      const res = await failingHandler(
        { op: "build", images: [], options: DEFAULT_LAYOUT_OPTIONS },
        { progress: vi.fn() },
      );
      expect(res.result).toEqual({
        status: "error",
        reason: "failed",
        message: "WASM load failed",
      });
    });
  });
});
