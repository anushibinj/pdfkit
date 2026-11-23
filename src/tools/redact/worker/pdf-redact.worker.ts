/// <reference lib="webworker" />
/**
 * Composition root of the Redact PDF Web Worker: wires PDFium, the
 * `pdf-redact` WebAssembly sanitizer, and standard font metrics together.
 */
import { loadPdfium } from "@/lib/pdfium/load-pdfium";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { StandardFontMetricsSource } from "@/tools/edit/core/standard-font-metrics";
import { fetchBytes } from "@/tools/crop/worker/fetch-bytes";
import { PdfRedactModule } from "../engine/pdf-redact-module";
import { asRedactPdfiumApi } from "../engine/redact-pdfium-api";
import { RedactSession } from "../engine/redact-session";
import type { RedactRequest, RedactWorkerResult } from "../messages";
import { createRedactHandler } from "./redact-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// Downloaded lazily on the first redaction apply (opening/searching never need it).
const redactModule = retryableOnce(() =>
  PdfRedactModule.load(`${WASM_DIR}pdf-redact.wasm`, (url) => fetchBytes(url)),
);

const session = retryableOnce(
  async () =>
    new RedactSession(
      await loadPdfium(
        WASM_DIR,
        (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
        asRedactPdfiumApi,
      ),
      new StandardFontMetricsSource(),
      () => redactModule.get(),
    ),
);

exposeWorker<RedactRequest, RedactWorkerResult>(
  scope,
  createRedactHandler(() => session.get()),
);
