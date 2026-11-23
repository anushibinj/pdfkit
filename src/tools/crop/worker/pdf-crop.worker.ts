/// <reference lib="webworker" />
/**
 * Composition root of the crop tool's worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { loadPdfium } from "@/lib/pdfium/load-pdfium";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { asCropPdfiumApi } from "../engine/crop-pdfium-api";
import { CropSession } from "../engine/crop-session";
import { PdfCropModule } from "../engine/pdf-crop-module";
import type { CropRequest, CropWorkerResult } from "../messages";
import { createCropHandler } from "./crop-handler";
import { fetchBytes } from "./fetch-bytes";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// The cropping module is downloaded on the first crop only (opening and
// previewing never need it), then reused. A failed download is retried.
const cropModule = retryableOnce(() =>
  PdfCropModule.load(`${WASM_DIR}pdf-crop.wasm`, (url) => fetchBytes(url)),
);

// PDFium is downloaded and compiled on the first request, then reused.
const session = retryableOnce(
  async () =>
    new CropSession(
      await loadPdfium(
        WASM_DIR,
        // The glue is a static file in public/, not part of the bundle.
        (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
        asCropPdfiumApi,
      ),
      () => cropModule.get(),
    ),
);

exposeWorker<CropRequest, CropWorkerResult>(
  scope,
  createCropHandler(() => session.get()),
);
