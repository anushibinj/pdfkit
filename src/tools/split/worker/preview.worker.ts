/// <reference lib="webworker" />
/**
 * Composition root of the Split PDF preview worker (PDFium): it only wires
 * the pieces together. All logic lives in tested modules.
 */
import { loadPdfiumModule } from "@/lib/pdfium/load-pdfium";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { PreviewSession } from "../engine/preview-session";
import type { PreviewRequest, PreviewResult } from "../messages";
import { asPreviewApi } from "./load-pdfium";
import { createPreviewHandler } from "./preview-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// PDFium is downloaded and compiled on the first request only, then reused.
// A failed download is retried on the next request.
const session = retryableOnce(
  async () =>
    new PreviewSession(
      asPreviewApi(
        await loadPdfiumModule(
          WASM_DIR,
          // The glue is a static file in public/, not part of the bundle.
          (url) =>
            import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
        ),
      ),
    ),
);

exposeWorker<PreviewRequest, PreviewResult>(
  scope,
  createPreviewHandler(() => session.get()),
);
