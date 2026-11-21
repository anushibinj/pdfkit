/// <reference lib="webworker" />
/**
 * Composition root of the watermark worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { instantiateFromUrl } from "@/lib/qpdf/instantiate-wasm";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import type { WatermarkRequest, WatermarkResult } from "../messages";
import { engineLoaders, loadWatermarkSession } from "./load-engines";
import { createWatermarkHandler } from "./watermark-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// The engines are downloaded and compiled on the first request only, then
// reused. A failed download is retried on the next request.
const session = retryableOnce(() =>
  loadWatermarkSession(
    engineLoaders(
      WASM_DIR,
      // The glue files are static files in public/, not part of the bundle.
      (url) =>
        import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
      instantiateFromUrl(`${WASM_DIR}qpdf.wasm`),
      console,
    ),
  ),
);

exposeWorker<WatermarkRequest, WatermarkResult>(
  scope,
  createWatermarkHandler(() => session.get()),
);
