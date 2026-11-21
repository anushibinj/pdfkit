/// <reference lib="webworker" />
/**
 * Composition root of the Split PDF assembly worker (qpdf): it only wires
 * the pieces together. All logic lives in tested modules.
 */
import { instantiateWasmFromUrl, loadQpdf } from "@/lib/qpdf/load-qpdf";
import { StderrLog } from "@/lib/qpdf/qpdf-runner";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { PageAssembler } from "../engine/page-assembler";
import type { AssembleRequest, AssembleResult } from "../messages";
import { createAssembleHandler } from "./assemble-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// One stderr log for the worker's lifetime: every qpdf (re)load writes into
// it (see loadQpdf). stdout is not read by this tool, so it is discarded.
const stderr = new StderrLog();

// qpdf is loaded on the first request and reused. A failed load is retried
// on the next request, and after a crash the instance is dropped (reset)
// so the next request starts from a fresh one.
const assembler = retryableOnce(async () => {
  const qpdf = await loadQpdf({
    wasmDir: WASM_DIR,
    // The glue is a static file in public/, not part of the bundle.
    importModule: (url) =>
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
    instantiate: instantiateWasmFromUrl,
    console,
    stderr,
  });
  return new PageAssembler(qpdf);
});

exposeWorker<AssembleRequest, AssembleResult>(
  scope,
  createAssembleHandler(
    () => assembler.get(),
    () => assembler.reset(),
  ),
);
