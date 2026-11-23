/// <reference lib="webworker" />
/**
 * Web Worker entry point for the Compress PDF tool.
 *
 * Serves as the composition root (Dependency Inversion Principle): lazily loads
 * `pdf-compress.wasm`, `qpdf.wasm`, and `pdfium.wasm`, plus browser `OffscreenCanvas`
 * JPEG encoding with Rust fallback, and exposes the worker protocol handler.
 */

import type { RgbaImage } from "@/lib/png/png-encoder";
import { instantiateWasmFromUrl, loadQpdf } from "@/lib/qpdf/load-qpdf";
import { StderrLog } from "@/lib/qpdf/qpdf-runner";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import {
  createJpegEncoder,
  platformCanvas,
} from "@/tools/pdf-to-images/worker/encoders";
import { loadImagesPdfium } from "@/tools/pdf-to-images/worker/load-pdfium";
import { PdfCompressModule } from "../engine/compress-pdf-module";
import { CompressSession } from "../engine/compress-session";
import {
  PdfiumImageExtractor,
  type JpegEncodeFn,
} from "../engine/pdfium-image-extractor";
import { QpdfLosslessOptimizer } from "../engine/qpdf-optimizer";
import type { CompressRequest, CompressWorkerResult } from "../messages";
import { createCompressHandler } from "./compress-handler";
import { fetchBytes } from "./fetch-bytes";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

const compressModule = retryableOnce(() =>
  PdfCompressModule.load(`${WASM_DIR}pdf-compress.wasm`, fetchBytes),
);

const qpdfStderr = new StderrLog();
const qpdfRunner = retryableOnce(() =>
  loadQpdf({
    wasmDir: WASM_DIR,
    importModule: (url) =>
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
    instantiate: instantiateWasmFromUrl,
    console,
    stderr: qpdfStderr,
  }),
);

const pdfiumApi = retryableOnce(() =>
  loadImagesPdfium(
    WASM_DIR,
    (url) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
  ),
);

/**
 * Downsamples RGBA pixels using `OffscreenCanvas` (if available) for fast
 * browser-native JPEG encoding, falling back to `PdfCompressModule.encodeJpeg`
 * when `OffscreenCanvas` is absent or for grayscale 1-channel JPEGs.
 */
function buildWorkerJpegEncoder(mod: PdfCompressModule): JpegEncodeFn {
  const canvas = platformCanvas();
  const canvasJpeg = canvas ? createJpegEncoder(canvas) : null;

  return async (
    image: RgbaImage,
    targetWidth: number,
    targetHeight: number,
    quality: number,
    grayscale: boolean,
  ): Promise<Uint8Array> => {
    // Use Rust's native 1-channel DeviceGray encoder for grayscale conversions or when
    // OffscreenCanvas is unavailable, as HTML5 Canvas always encodes 3-channel YCbCr.
    if (grayscale || !canvas || !canvasJpeg) {
      return mod.encodeJpeg(
        image.pixels,
        image.width,
        image.height,
        targetWidth,
        targetHeight,
        quality,
        grayscale,
      );
    }

    try {
      if (targetWidth === image.width && targetHeight === image.height) {
        return await canvasJpeg(image, quality);
      }

      // Draw source pixels into an offscreen source canvas, then scale onto target canvas
      const srcCanvas = new OffscreenCanvas(image.width, image.height);
      const srcCtx = srcCanvas.getContext("2d");
      if (!srcCtx) {
        return mod.encodeJpeg(
          image.pixels,
          image.width,
          image.height,
          targetWidth,
          targetHeight,
          quality,
          false,
        );
      }

      const clamped = new Uint8ClampedArray(
        image.pixels.buffer as ArrayBuffer,
        image.pixels.byteOffset,
        image.pixels.byteLength,
      );
      srcCtx.putImageData(
        new ImageData(clamped, image.width, image.height),
        0,
        0,
      );

      const dstCanvas = new OffscreenCanvas(targetWidth, targetHeight);
      const dstCtx = dstCanvas.getContext("2d");
      if (!dstCtx) {
        return mod.encodeJpeg(
          image.pixels,
          image.width,
          image.height,
          targetWidth,
          targetHeight,
          quality,
          false,
        );
      }

      dstCtx.imageSmoothingEnabled = true;
      dstCtx.imageSmoothingQuality = "high";
      dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
      const blob = await dstCanvas.convertToBlob({
        type: "image/jpeg",
        quality,
      });
      if (blob.type !== "image/jpeg") {
        throw new Error("Browser returned non-JPEG blob");
      }
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      return mod.encodeJpeg(
        image.pixels,
        image.width,
        image.height,
        targetWidth,
        targetHeight,
        quality,
        grayscale,
      );
    }
  };
}

const session = retryableOnce(async () => {
  const [mod, qpdf, pdfium] = await Promise.all([
    compressModule.get(),
    qpdfRunner.get(),
    pdfiumApi.get(),
  ]);
  return new CompressSession(
    mod,
    new QpdfLosslessOptimizer(qpdf),
    new PdfiumImageExtractor(pdfium),
    buildWorkerJpegEncoder(mod),
  );
});

exposeWorker<CompressRequest, CompressWorkerResult>(
  scope,
  createCompressHandler(() => session.get()),
);
