/**
 * Imports a JavaScript module by URL.
 *
 * Workers pass a real dynamic `import()` (marked so the bundler leaves the
 * URL alone, because engine glue files are static files under /wasm/, not
 * part of the bundle). Tests pass a function that returns a fake module, so
 * engine loaders can be checked without a network or a WebAssembly binary.
 */
export type ModuleImporter = (url: string) => Promise<unknown>;
