/// <reference lib="webworker" />
/**
 * Composition root of the HTML to PDF worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { createConvertHandler } from "@/lib/html-pdf/convert-handler";
import { IronpressEngine } from "@/lib/html-pdf/ironpress-engine";
import { loadIronpress } from "@/lib/html-pdf/load-ironpress";
import type { ConvertResult } from "@/lib/html-pdf/types";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { HtmlToPdfConverter } from "../core/html-to-pdf";
import type { HtmlConvertRequest } from "../messages";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// The engine (the same ironpress files the Markdown tool uses, so a visitor
// who used either tool already has them cached) is downloaded and compiled
// on the first conversion only, then reused. A failed download is retried on
// the next request.
const converter = retryableOnce(async () => {
  const ironpress = await loadIronpress(
    WASM_DIR,
    // The glue is a static file in public/, not part of the bundle.
    (url) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
  );
  return new HtmlToPdfConverter(new IronpressEngine(ironpress));
});

exposeWorker<HtmlConvertRequest, ConvertResult>(
  scope,
  createConvertHandler(() => converter.get()),
);
