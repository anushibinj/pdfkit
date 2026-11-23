/// <reference lib="webworker" />
/**
 * Composition root of the PDF to Images worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { ImagesSession } from "../engine/images-session";
import type { ImagesRequest, ImagesResult } from "../messages";
import { createEncoders } from "./encoders";
import { createImagesHandler } from "./images-handler";
import { loadImagesPdfium } from "./load-pdfium";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// PDFium is downloaded and compiled on the first request only, then reused
// for every later one. A failed download is retried on the next request.
const session = retryableOnce(
  async () =>
    new ImagesSession(
      await loadImagesPdfium(
        WASM_DIR,
        // The glue is a static file in public/, not part of the bundle.
        (url) =>
          import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
      ),
      createEncoders(),
    ),
);

exposeWorker<ImagesRequest, ImagesResult>(
  scope,
  createImagesHandler(() => session.get()),
);
