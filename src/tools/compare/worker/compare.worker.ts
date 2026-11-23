/// <reference lib="webworker" />
/**
 * Composition root of the Compare PDFs Web Worker.
 * Wires lazy PDFium WASM loading, `CompareSession`, and `exposeWorker`.
 */
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { CompareSession } from "../engine/compare-session";
import type { CompareRequest, CompareWorkerResult } from "../messages";
import { createCompareHandler } from "./compare-handler";
import { loadComparePdfium } from "./load-pdfium";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

const session = retryableOnce(
  async () =>
    new CompareSession(
      await loadComparePdfium(
        WASM_DIR,
        (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
      ),
    ),
);

exposeWorker<CompareRequest, CompareWorkerResult>(
  scope,
  createCompareHandler(() => session.get()),
);
