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

/** Imports a module by URL; the worker passes a real dynamic `import()`. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * Narrows the full PDFium module to the interface a tool uses. Each tool
 * passes an identity function typed with its own interface (e.g. the
 * editor's `asPdfiumApi`): at runtime it returns the module unchanged, and
 * at compile time TypeScript checks that the library's real signatures
 * still match that interface (after an upgrade, say), instead of the tool
 * failing in a user's browser.
 */
export type PdfiumNarrower<Api> = (pdfium: WrappedPdfiumModule) => Api;

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
 * @param narrow Types the module as the tool's interface (see
 *   {@link PdfiumNarrower}).
 * @returns The ready-to-use API.
 */
export async function loadPdfium<Api>(
  wasmDir: string,
  importer: ModuleImporter,
  narrow: PdfiumNarrower<Api>,
): Promise<Api> {
  const glue = (await importer(`${wasmDir}pdfium.js`)) as PdfiumGlue;
  const pdfium = await glue.init({ locateFile: (path) => `${wasmDir}${path}` });
  pdfium.PDFiumExt_Init();
  return narrow(pdfium);
}
