/// <reference lib="webworker" />
/**
 * Composition root of the PDF Unlocker worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { instantiateFromUrl } from "@/lib/qpdf/instantiate-wasm";
import { loadQpdf } from "@/lib/qpdf/load-qpdf";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import type { UnlockRequest, UnlockResult } from "../messages";
import { createUnlockHandler } from "./unlock-job";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// qpdf is downloaded and compiled on the first request only, then reused.
// A failed download is retried on the next request; after a crash the
// handler resets it so the next request gets a fresh instance.
const qpdf = retryableOnce(() =>
  loadQpdf(WASM_DIR, {
    // The glue is a static file in public/, not part of the bundle.
    importer: (url) =>
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
    instantiate: instantiateFromUrl(`${WASM_DIR}qpdf.wasm`),
    console,
  }),
);

exposeWorker<UnlockRequest, UnlockResult>(scope, createUnlockHandler(qpdf));
