import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { PdfiumApi } from "../engine/pdfium-api";

/**
 * What `pdfium.js` (the package's browser build, copied to /wasm/) exports:
 * an `init` that instantiates the WebAssembly binary and wraps every C
 * function.
 */
export interface PdfiumGlue {
  init(options: {
    locateFile(path: string): string;
  }): Promise<WrappedPdfiumModule>;
}

/** Imports a module by URL; the worker passes a real dynamic `import()`. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * Narrow the full PDFium module to the editor's interface.
 *
 * This is an identity function at runtime. Its value is at compile time:
 * if the library's real signatures ever stop matching `PdfiumApi` (after an
 * upgrade, say), TypeScript fails here instead of the editor failing in a
 * user's browser.
 *
 * @param pdfium The initialised module.
 * @returns The same module, typed as {@link PdfiumApi}.
 */
export function asPdfiumApi(pdfium: WrappedPdfiumModule): PdfiumApi {
  return pdfium;
}

/**
 * Load and initialise PDFium from our own origin.
 *
 * Both files are static files under `wasmDir` (copied there by
 * `scripts/copy-wasm.mjs`), never a CDN, and never part of the bundle, so
 * the bundler does not try to inline a 4.6 MB binary. `locateFile` points
 * Emscripten at the binary explicitly (its built-in fallback would derive
 * the same URL from the glue's own address, but being explicit keeps the
 * request visible here). `PDFiumExt_Init` initialises the library once per
 * instance and must run before any other call.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param importer Performs the dynamic import (injected for tests).
 * @returns The ready-to-use API.
 */
export async function loadPdfium(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<PdfiumApi> {
  const glue = (await importer(`${wasmDir}pdfium.js`)) as PdfiumGlue;
  const pdfium = await glue.init({ locateFile: (path) => `${wasmDir}${path}` });
  pdfium.PDFiumExt_Init();
  return asPdfiumApi(pdfium);
}
