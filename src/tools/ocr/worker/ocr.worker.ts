/// <reference lib="webworker" />
/**
 * Web Worker entry point for the OCR PDF tool.
 *
 * Composition root (Dependency Inversion Principle): lazily loads all engines
 * exclusively from same-origin `/wasm/` (`pdf-ocr.wasm`, `tesseract-core-*-lstm`,
 * `qpdf.wasm`, `pdfium.wasm`, and user-selected `<lang>.traineddata.gz`) so no
 * third-party network requests or `blob:` workers are ever made.
 */

import { instantiateWasmFromUrl, loadQpdf } from "@/lib/qpdf/load-qpdf";
import { StderrLog } from "@/lib/qpdf/qpdf-runner";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { fetchBytes } from "@/tools/compress/worker/fetch-bytes";
import type { OcrLanguageCode } from "../core/model";
import { OcrSession } from "../engine/ocr-session";
import { PdfOcrModule } from "../engine/pdf-ocr-module";
import { loadOcrPdfium } from "../engine/pdfium-api";
import { PdfiumPageProcessor } from "../engine/pdfium-page-processor";
import { QpdfOverlayApplier } from "../engine/qpdf-overlay-applier";
import {
  loadSelfHostedTesseractCore,
  TesseractWasmRecognizer,
} from "../engine/tesseract-recognizer";
import type { OcrRequest, OcrWorkerResult } from "../messages";
import { createOcrHandler } from "./ocr-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

const ocrHelperModule = retryableOnce(() =>
  PdfOcrModule.load(`${WASM_DIR}pdf-ocr.wasm`, fetchBytes),
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
  loadOcrPdfium(
    WASM_DIR,
    (url) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
  ),
);

const session = retryableOnce(async () => {
  const [helper, qpdf, pdfium] = await Promise.all([
    ocrHelperModule.get(),
    qpdfRunner.get(),
    pdfiumApi.get(),
  ]);

  const recognizer = new TesseractWasmRecognizer(
    helper,
    async (lang: OcrLanguageCode) => {
      const buf = await fetchBytes(`${WASM_DIR}${lang}.traineddata.gz`);
      return new Uint8Array(buf);
    },
    async (onProgress) => {
      const { factory, wasmFile } = await loadSelfHostedTesseractCore(
        WASM_DIR,
        (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
      );
      return factory({
        locateFile: (file) =>
          file.endsWith(".wasm") ? wasmFile : `${WASM_DIR}${file}`,
        TesseractProgress: onProgress,
      });
    },
  );

  return new OcrSession(
    helper,
    new PdfiumPageProcessor(pdfium),
    recognizer,
    new QpdfOverlayApplier(qpdf),
  );
});

exposeWorker<OcrRequest, OcrWorkerResult>(
  scope,
  createOcrHandler(() => session.get()),
);
