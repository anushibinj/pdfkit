/// <reference lib="webworker" />
/**
 * Composition root of the Merge PDFs worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { createStreamingInstantiator, loadQpdf } from "@/lib/qpdf/load-qpdf";
import { QpdfOutput } from "@/lib/qpdf/qpdf-output";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { QpdfMerger } from "../core/qpdf-merger";
import type { MergeWorkerRequest, MergeWorkerResult } from "../messages";
import { createMergeHandler } from "./merge-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// One output for the worker's whole life: every load attempt attaches it to
// the console, so whichever attempt succeeds reads into this same object.
const output = new QpdfOutput();

// qpdf is loaded on the first request and reused; a failed load, a crash or
// an out-of-memory error makes the next request load a fresh instance.
const merger = retryableOnce(
  async () =>
    new QpdfMerger(
      await loadQpdf({
        wasmDir: WASM_DIR,
        // The glue is a static file in public/, not part of the bundle.
        importer: (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
        instantiate: createStreamingInstantiator((url) => fetch(url)),
        output,
        console,
      }),
    ),
);

exposeWorker<MergeWorkerRequest, MergeWorkerResult>(
  scope,
  createMergeHandler(
    () => merger.get(),
    () => merger.reset(),
  ),
);
