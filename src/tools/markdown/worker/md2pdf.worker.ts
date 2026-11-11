/// <reference lib="webworker" />
/**
 * Composition root of the Markdown to PDF worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { IronpressEngine } from "../core/ironpress-engine";
import { MarkedMarkdownRenderer } from "../core/markdown-renderer";
import { MarkdownToPdfConverter } from "../core/markdown-to-pdf";
import type { ConvertRequest, ConvertResult } from "../messages";
import { createConvertHandler } from "./convert-handler";
import { loadIronpress } from "./load-ironpress";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// The engine is downloaded and compiled on the first conversion only, then
// reused. A failed download is retried on the next request.
const converter = retryableOnce(async () => {
  const ironpress = await loadIronpress(
    WASM_DIR,
    // The glue is a static file in public/, not part of the bundle.
    (url) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
  );
  return new MarkdownToPdfConverter(
    new MarkedMarkdownRenderer(),
    new IronpressEngine(ironpress),
  );
});

exposeWorker<ConvertRequest, ConvertResult>(
  scope,
  createConvertHandler(() => converter.get()),
);
