import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { ModuleImporter } from "@/lib/module-importer";

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
 * The full module is returned, or narrowed to a tool's own interface via `narrow`.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param importer Performs the dynamic import (injected for tests).
 * @param narrow Optional function to narrow the full module to a tool-specific API.
 * @returns The ready-to-use module.
 */
export async function loadPdfiumModule<T = WrappedPdfiumModule>(
  wasmDir: string,
  importer: ModuleImporter,
  narrow?: (pdfium: WrappedPdfiumModule) => T,
): Promise<T> {
  const glue = (await importer(`${wasmDir}pdfium.js`)) as PdfiumGlue;
  const pdfium = await glue.init({ locateFile: (path) => `${wasmDir}${path}` });
  pdfium.PDFiumExt_Init();
  return narrow ? narrow(pdfium) : (pdfium as unknown as T);
}

export const loadPdfium = loadPdfiumModule;
