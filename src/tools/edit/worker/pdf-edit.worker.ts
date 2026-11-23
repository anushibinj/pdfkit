/// <reference lib="webworker" />
/**
 * Composition root of the PDF editor worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { loadPdfium } from "@/lib/pdfium/load-pdfium";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { StandardFontMetricsSource } from "../core/standard-font-metrics";
import { EditorSession } from "../engine/editor-session";
import type { EditorRequest, EditorResult } from "../messages";
import { createEditHandler } from "./edit-handler";
import { asPdfiumApi } from "./load-pdfium";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// PDFium is downloaded and compiled on the first request only, then reused
// for every later one. A failed download is retried on the next request.
const session = retryableOnce(
  async () =>
    new EditorSession(
      await loadPdfium(
        WASM_DIR,
        // The glue is a static file in public/, not part of the bundle.
        (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
        asPdfiumApi,
      ),
      new StandardFontMetricsSource(),
    ),
);

exposeWorker<EditorRequest, EditorResult>(
  scope,
  createEditHandler(() => session.get()),
);
