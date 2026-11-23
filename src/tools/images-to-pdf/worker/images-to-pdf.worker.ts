/// <reference lib="webworker" />
/**
 * Composition root of the Images to PDF Web Worker.
 * Wires PDFium lazy loading, `ImagesToPdfBuilder`, and `exposeWorker`.
 * All business logic lives in unit-tested modules.
 */
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { ImagesToPdfBuilder } from "../engine/pdf-builder";
import type { BuildPdfRequest, BuildPdfResult } from "../messages";
import { createImagesToPdfHandler } from "./images-to-pdf-handler";
import { loadImagesToPdfPdfium } from "./load-pdfium";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// Load and compile PDFium WASM on first conversion only; retry on transient
// load failure, and reuse the same instance across subsequent conversions.
const engine = retryableOnce(
  async () =>
    new ImagesToPdfBuilder(
      await loadImagesToPdfPdfium(
        WASM_DIR,
        // `/wasm/pdfium.js` is a static file copied by `scripts/copy-wasm.mjs`.
        (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
      ),
    ),
);

exposeWorker<BuildPdfRequest, BuildPdfResult>(
  scope,
  createImagesToPdfHandler(() => engine.get()),
);
