import type { IronpressApi } from "../core/ironpress-engine";

/**
 * What the wasm-bindgen glue file (`ironpress.js`) exports: a default `init`
 * function that instantiates the WebAssembly binary, plus the API classes.
 */
export interface IronpressGlue extends IronpressApi {
  default(options: { module_or_path: string }): Promise<unknown>;
}

/** Imports a module by URL; the worker passes a real dynamic `import()`. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * Load and initialise ironpress from our own origin.
 *
 * Both the glue (`ironpress.js`) and the binary (`ironpress_bg.wasm`) are
 * static files under `wasmDir` (copied there by `scripts/copy-wasm.mjs`), not
 * part of the bundle, so the bundler never tries to inline a 15 MB file.
 * The binary's URL is passed explicitly: the glue's fallback would resolve it
 * relative to its own `import.meta.url`, which is the same place, but being
 * explicit keeps the request visible here and independent of glue internals.
 *
 * The importer is injected so tests can verify the URLs without a network.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param importer Performs the dynamic import.
 * @returns The initialised ironpress API.
 */
export async function loadIronpress(
  wasmDir: string,
  importer: ModuleImporter,
): Promise<IronpressApi> {
  const glue = (await importer(`${wasmDir}ironpress.js`)) as IronpressGlue;
  await glue.default({ module_or_path: `${wasmDir}ironpress_bg.wasm` });
  return { HtmlConverter: glue.HtmlConverter };
}
