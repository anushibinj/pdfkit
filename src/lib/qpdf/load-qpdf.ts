import type { QpdfFactory, QpdfModule } from "./qpdf-module";
import type { ConsoleLike, QpdfOutput } from "./qpdf-output";
import { QpdfRunner } from "./qpdf-runner";

/** Imports a module by URL; a worker passes a real dynamic `import()`. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/** Downloads and instantiates a WebAssembly binary with the given imports. */
export type WasmInstantiator = (
  url: string,
  imports: WebAssembly.Imports,
) => Promise<WebAssembly.Instance>;

/** What the glue file (`qpdf.mjs`) exports. */
export interface QpdfGlue {
  default: QpdfFactory;
}

/**
 * Build a {@link WasmInstantiator} that streams the binary and falls back to
 * a plain download.
 *
 * `WebAssembly.instantiateStreaming` compiles while downloading, but only
 * accepts a response served as `application/wasm`. Some static hosts (and
 * some local preview servers) send another type; the fallback then downloads
 * the bytes and compiles them in one go. The service worker answers the second
 * request from its cache, so the fallback rarely costs a second download.
 *
 * @param fetchFn The `fetch` to use (injected for tests).
 * @returns The instantiator.
 */
export function createStreamingInstantiator(
  fetchFn: (url: string) => Promise<Response>,
): WasmInstantiator {
  return async (url, imports) => {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(
        fetchFn(url),
        imports,
      );
      return instance;
    } catch {
      const bytes = await (await fetchFn(url)).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, imports);
      return instance;
    }
  };
}

/**
 * Run the Emscripten factory with our own WebAssembly instantiation.
 *
 * Why the race: we take instantiation over through `instantiateWasm`, so
 * Emscripten only learns about success when we call `done`. If our download
 * or compilation fails, `done` is never called and the factory's promise
 * never settles: a caller awaiting it alone would hang forever. So:
 * 1. `loadFailed` is a second promise that our instantiation rejects on
 *    failure.
 * 2. `Promise.race` settles with whichever comes first: the ready module
 *    (success) or that rejection (failure).
 * On success `loadFailed` simply never settles, which leaks nothing.
 *
 * @param factory The glue's default export.
 * @param wasmDir Absolute URL of the directory holding `qpdf.wasm`, ending in "/".
 * @param instantiate Downloads and instantiates the binary.
 * @returns The ready module.
 */
export function instantiateQpdf(
  factory: QpdfFactory,
  wasmDir: string,
  instantiate: WasmInstantiator,
): Promise<QpdfModule> {
  let failLoad: (reason: unknown) => void = () => {};
  const loadFailed = new Promise<never>((_, reject) => {
    failLoad = reject;
  });
  const ready = factory({
    noInitialRun: true,
    locateFile: (file) => `${wasmDir}${file}`,
    instantiateWasm(imports, done) {
      instantiate(`${wasmDir}qpdf.wasm`, imports).then(done, failLoad);
      return {};
    },
  });
  return Promise.race([ready, loadFailed]);
}

/** Everything {@link loadQpdf} needs, injected so it can be tested. */
export interface LoadQpdfOptions {
  /** Absolute URL of the directory with `qpdf.mjs` and `qpdf.wasm`, ending in "/". */
  wasmDir: string;
  importer: ModuleImporter;
  instantiate: WasmInstantiator;
  /**
   * Receives qpdf's stdout and stderr. Pass the same object on every attempt
   * in a worker, so a retry after a failed download still reads into it.
   */
  output: QpdfOutput;
  /** The console qpdf binds (the worker's global `console`). */
  console: ConsoleLike;
}

/**
 * Load qpdf from our own origin and return a runner for it.
 *
 * Order matters: the output forwarders are attached to the console first,
 * because the factory binds `console.log`/`console.warn` while it runs (see
 * `QpdfOutput`). The glue is a static file under `wasmDir` (copied there by
 * `scripts/copy-wasm.mjs`), never bundled and never fetched from a CDN.
 *
 * @param options See {@link LoadQpdfOptions}.
 * @returns A runner for the loaded module.
 * @throws When the glue or the binary cannot be loaded.
 */
export async function loadQpdf(options: LoadQpdfOptions): Promise<QpdfRunner> {
  const { wasmDir, importer, instantiate, output } = options;
  output.attachTo(options.console);
  const glue = (await importer(`${wasmDir}qpdf.mjs`)) as QpdfGlue;
  const qpdf = await instantiateQpdf(glue.default, wasmDir, instantiate);
  return new QpdfRunner(qpdf, output);
}
