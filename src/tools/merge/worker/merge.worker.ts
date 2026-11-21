/// <reference lib="webworker" />
/**
 * Composition root of the Merge PDFs worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { instantiateWasmFromUrl, loadQpdf } from "@/lib/qpdf/load-qpdf";
import { StderrLog } from "@/lib/qpdf/qpdf-runner";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { PdfMerger } from "../core/pdf-merger";
import type { MergeWorkerRequest, MergeWorkerResult } from "../messages";
import { createMergeHandler } from "./merge-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// One pair of logs for the worker's lifetime: every qpdf (re)load writes
// into them. stdout is captured because page counts are read from it.
const stderr = new StderrLog();
const stdout = new StderrLog();

// qpdf is loaded on the first request only, then reused. A failed load, or a
// crash during a job (see createMergeHandler), makes the next request load a
// fresh instance.
const merger = retryableOnce(async () => {
  const qpdf = await loadQpdf({
    wasmDir: WASM_DIR,
    // The glue is a static file in public/, not part of the bundle.
    importModule: (url) =>
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
    instantiate: instantiateWasmFromUrl,
    console,
    stderr,
    stdout,
  });
  return new PdfMerger(qpdf);
});

exposeWorker<MergeWorkerRequest, MergeWorkerResult>(
  scope,
  createMergeHandler(merger),
);
