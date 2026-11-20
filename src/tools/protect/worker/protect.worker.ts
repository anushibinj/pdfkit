/// <reference lib="webworker" />
/**
 * Composition root of the Protect PDF worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { instantiateWasmFromUrl, loadQpdf } from "@/lib/qpdf/load-qpdf";
import { StderrLog } from "@/lib/qpdf/qpdf-runner";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { PdfProtector } from "../core/pdf-protector";
import type { ProtectRequest, ProtectResult } from "../messages";
import { createProtectHandler } from "./protect-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// One log for the worker's lifetime: every qpdf (re)load writes into it.
const stderr = new StderrLog();

// qpdf is loaded on the first request only, then reused. A failed load, or a
// crash during a job (see createProtectHandler), makes the next request load
// a fresh instance.
const protector = retryableOnce(async () => {
  const qpdf = await loadQpdf({
    wasmDir: WASM_DIR,
    // The glue is a static file in public/, not part of the bundle.
    importModule: (url) =>
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
    instantiate: instantiateWasmFromUrl,
    console,
    stderr,
  });
  return new PdfProtector(qpdf);
});

exposeWorker<ProtectRequest, ProtectResult>(
  scope,
  createProtectHandler(protector),
);
