import { describe, expect, it, vi } from "vitest";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { fakeImagesToPdfPdfium } from "../test-utils/fake-pdfium";
import {
  CompositeImageEmbedder,
  InvalidImageError,
  JpegEmbedStrategy,
  PngEmbedStrategy,
  UNREADABLE_IMAGE_MESSAGE,
  readDecodedImageSize,
  type ImageEmbedStrategy,
} from "./image-embedder";

describe("image-embedder", () => {
  describe("PngEmbedStrategy & JpegEmbedStrategy", () => {
    it("matches only its respective MIME type", () => {
      const png = new PngEmbedStrategy();
      const jpeg = new JpegEmbedStrategy();
      expect(png.supports("image/png")).toBe(true);
      expect(png.supports("image/jpeg")).toBe(false);
      expect(jpeg.supports("image/jpeg")).toBe(true);
      expect(jpeg.supports("image/png")).toBe(false);
    });

    it("delegates loadIntoObject to EPDFImageObj_SetPng / EPDFImageObj_SetJpeg", () => {
      const { api } = fakeImagesToPdfPdfium();
      const png = new PngEmbedStrategy();
      const jpeg = new JpegEmbedStrategy();

      expect(png.loadIntoObject(api, 10, 20, 300, 40)).toBe(true);
      expect(api.EPDFImageObj_SetPng).toHaveBeenCalledWith(10, 0, 20, 300, 40);

      expect(jpeg.loadIntoObject(api, 11, 21, 310, 50)).toBe(true);
      expect(api.EPDFImageObj_SetJpeg).toHaveBeenCalledWith(11, 0, 21, 310, 50);
    });
  });

  describe("readDecodedImageSize", () => {
    it("reads width and height and frees the temporary WASM buffer", () => {
      const { api, runtime } = fakeImagesToPdfPdfium();
      const heap = new WasmHeap(api.pdfium);

      expect(readDecodedImageSize(api, heap, 55)).toEqual({
        width: 100,
        height: 80,
      });
      expect(runtime.leaks()).toEqual([]);
    });

    it("returns null when PDFium returns false or 0 x 0", () => {
      const { api, runtime } = fakeImagesToPdfPdfium();
      const heap = new WasmHeap(api.pdfium);

      api.FPDFImageObj_GetImagePixelSize.mockReturnValueOnce(false);
      expect(readDecodedImageSize(api, heap, 55)).toBeNull();

      api.FPDFImageObj_GetImagePixelSize.mockImplementationOnce((_o, w, h) => {
        runtime.setValue(w, 0);
        runtime.setValue(h, 0);
        return true;
      });
      expect(readDecodedImageSize(api, heap, 55)).toBeNull();
      expect(runtime.leaks()).toEqual([]);
    });
  });

  describe("CompositeImageEmbedder", () => {
    it("embeds PNG and JPEG images and frees temporary WASM memory", () => {
      const { api, runtime } = fakeImagesToPdfPdfium();
      const heap = new WasmHeap(api.pdfium);
      const embedder = new CompositeImageEmbedder();
      const bytes = new Uint8Array([1, 2, 3, 4]);

      expect(embedder.embed(api, heap, 1, 2, "image/png", bytes)).toEqual({
        width: 100,
        height: 80,
      });
      expect(api.EPDFImageObj_SetPng).toHaveBeenCalledTimes(1);
      expect(api.EPDFImageObj_SetJpeg).not.toHaveBeenCalled();

      expect(embedder.embed(api, heap, 1, 3, "image/jpeg", bytes)).toEqual({
        width: 100,
        height: 80,
      });
      expect(api.EPDFImageObj_SetJpeg).toHaveBeenCalledTimes(1);
      expect(runtime.leaks()).toEqual([]);
    });

    it("supports custom OCP strategies injected via constructor", () => {
      const { api } = fakeImagesToPdfPdfium();
      const heap = new WasmHeap(api.pdfium);
      const custom: ImageEmbedStrategy = {
        supports: (mime) => mime === "image/png",
        loadIntoObject: vi.fn(() => true),
      };
      const embedder = new CompositeImageEmbedder([custom]);
      embedder.embed(api, heap, 1, 2, "image/png", new Uint8Array([9]));
      expect(custom.loadIntoObject).toHaveBeenCalledTimes(1);
    });

    it("throws InvalidImageError on unsupported MIME, empty bytes, loader failure, or 0x0 decode", () => {
      const { api, runtime } = fakeImagesToPdfPdfium();
      const heap = new WasmHeap(api.pdfium);
      const embedder = new CompositeImageEmbedder();

      expect(() =>
        embedder.embed(api, heap, 1, 2, "image/webp" as never, new Uint8Array([1])),
      ).toThrow(InvalidImageError);

      expect(() =>
        embedder.embed(api, heap, 1, 2, "image/png", new Uint8Array(0)),
      ).toThrow(UNREADABLE_IMAGE_MESSAGE);

      api.EPDFImageObj_SetPng.mockReturnValueOnce(false);
      expect(() =>
        embedder.embed(api, heap, 1, 2, "image/png", new Uint8Array([1])),
      ).toThrow(InvalidImageError);

      api.FPDFImageObj_GetImagePixelSize.mockReturnValueOnce(false);
      expect(() =>
        embedder.embed(api, heap, 1, 2, "image/jpeg", new Uint8Array([1])),
      ).toThrow(InvalidImageError);

      expect(runtime.leaks()).toEqual([]);
    });
  });
});
