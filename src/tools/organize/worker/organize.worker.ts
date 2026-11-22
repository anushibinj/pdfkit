/// <reference lib="webworker" />
/**
 * Composition root of the page organizer worker: it only wires the pieces
 * together. All logic lives in tested modules.
 */
import { loadPdfiumModule } from "@/lib/pdfium/load-pdfium";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { OrganizeSession } from "../engine/organize-session";
import type { OrganizeRequest, OrganizeResult } from "../messages";
import { asOrganizeApi } from "./load-pdfium";
import { createOrganizeHandler } from "./organize-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// PDFium is downloaded and compiled on the first request only, then reused
// for every later one. A failed download is retried on the next request.
const session = retryableOnce(
  async () =>
    new OrganizeSession(
      asOrganizeApi(
        await loadPdfiumModule(
          WASM_DIR,
          // The glue is a static file in public/, not part of the bundle.
          (url) =>
            import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
        ),
      ),
    ),
);

exposeWorker<OrganizeRequest, OrganizeResult>(
  scope,
  createOrganizeHandler(() => session.get()),
);
