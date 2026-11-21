import type { WrappedPdfiumModule } from "@embedpdf/pdfium";

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

/** Imports a module by URL; a worker passes a real dynamic `import()`. */
export type ModuleImporter = (url: string) => Promise<unknown>;

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
 * The full module is returned. Each tool narrows it to the small interface
 * it actually uses with a typed identity function (see the editor's
 * `asPdfiumApi`), so a library upgrade that breaks a signature fails the
 * build instead of a user's session.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param importer Performs the dynamic import (injected for tests).
 * @returns The initialised module.
 */
export async function loadPdfiumModule(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<WrappedPdfiumModule> {
  const glue = (await importer(`${wasmDir}pdfium.js`)) as PdfiumGlue;
  const pdfium = await glue.init({ locateFile: (path) => `${wasmDir}${path}` });
  pdfium.PDFiumExt_Init();
  return pdfium;
}
