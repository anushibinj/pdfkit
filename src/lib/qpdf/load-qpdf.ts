import {
  EmscriptenQpdfRunner,
  type QpdfModule,
  type QpdfRunner,
  type StderrLog,
} from "./qpdf-runner";

/** Options of the Emscripten factory exported by `qpdf.mjs`. */
interface QpdfFactoryOptions {
  noInitialRun: boolean;
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
  instantiateWasm: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance) => void,
  ) => Record<string, never>;
}

/** The glue module's shape: a default-exported Emscripten factory. */
interface QpdfGlue {
  default: (options: QpdfFactoryOptions) => Promise<QpdfModule>;
}

/** Compiles and instantiates the binary at a URL with the given imports. */
export type WasmInstantiator = (
  url: string,
  imports: WebAssembly.Imports,
) => Promise<WebAssembly.Instance>;

/** The `WebAssembly` functions {@link instantiateWasmFromUrl} needs. */
export type WasmCompiler = Pick<
  typeof WebAssembly,
  "instantiateStreaming" | "instantiate"
>;

/**
 * Fetch and instantiate a WebAssembly binary.
 *
 * Streaming compilation is tried first: the browser compiles while the bytes
 * arrive. It requires the server to send `Content-Type: application/wasm`;
 * some static hosts and dev servers do not, and then it rejects. In that case
 * the binary is fetched again as a plain `ArrayBuffer` and compiled in one go.
 * (The second request is normally served from the HTTP or service worker
 * cache, so the fallback rarely costs a second download.)
 *
 * @param url Absolute URL of the `.wasm` file.
 * @param imports The import object Emscripten passes to `instantiateWasm`.
 * @param fetchFn The `fetch` to use (injected by tests).
 * @param wasm The `WebAssembly` functions to use (injected by tests).
 * @returns The instance.
 */
export async function instantiateWasmFromUrl(
  url: string,
  imports: WebAssembly.Imports,
  fetchFn: typeof fetch = fetch,
  wasm: WasmCompiler = WebAssembly,
): Promise<WebAssembly.Instance> {
  try {
    const { instance } = await wasm.instantiateStreaming(fetchFn(url), imports);
    return instance;
  } catch {
    const bytes = await (await fetchFn(url)).arrayBuffer();
    const { instance } = await wasm.instantiate(bytes, imports);
    return instance;
  }
}

/** Everything {@link loadQpdf} needs, injected so it can be tested. */
export interface QpdfLoadOptions {
  /** Absolute URL of the directory holding `qpdf.mjs` and `qpdf.wasm`, ending in "/". */
  wasmDir: string;
  /** Performs a dynamic `import()` of a URL. */
  importModule: (url: string) => Promise<unknown>;
  /** Instantiates the binary, normally {@link instantiateWasmFromUrl}. */
  instantiate: WasmInstantiator;
  /** The global console, whose `warn` and `log` are replaced (see below). */
  console: Pick<Console, "warn" | "log">;
  /**
   * Receives qpdf's stderr. Create ONE per worker and pass the same log to
   * every load (see the note on reloading below).
   */
  stderr: StderrLog;
}

/**
 * Load qpdf (the command line program compiled to WebAssembly) from our own
 * origin and wrap it in a {@link QpdfRunner}.
 *
 * How stderr is captured, and why it looks unusual:
 * - This qpdf build ignores Emscripten's `print`/`printErr` options. Its
 *   factory binds `console.log` and `console.warn` itself, each time it runs,
 *   and writes stdout and stderr through them.
 * - So, before the factory runs, `console.warn` is replaced with a function
 *   that appends to `stderr`, and `console.log` (qpdf's stdout, which no tool
 *   reads) with a no-op. This only affects the worker's console, never the
 *   page's.
 * - A worker reloads qpdf after a crash. Passing the same `stderr` log every
 *   time means that even a build which bound the console only once, on its
 *   first evaluation, would still write into the log the new runner reads.
 *   `printErr` is wired to the log as well, for builds that do honour it.
 *
 * Why the load races against `loadFailed`: when `instantiateWasm` is
 * supplied, Emscripten leaves instantiation entirely to us, and if it fails
 * Emscripten's own promise never settles. Rejecting `loadFailed` makes such a
 * failure (offline, CSP block, corrupt binary) surface as a rejection that
 * callers can retry, instead of a promise that hangs forever.
 *
 * @param options The directory, the importer, the instantiator, the console
 *   and the stderr log.
 * @returns A runner over a fresh qpdf instance.
 */
export async function loadQpdf(options: QpdfLoadOptions): Promise<QpdfRunner> {
  const { wasmDir, importModule, instantiate, stderr } = options;
  options.console.warn = (...args: unknown[]) =>
    stderr.append(args.map(String).join(" "));
  options.console.log = () => {};

  const glue = (await importModule(`${wasmDir}qpdf.mjs`)) as QpdfGlue;
  let failLoad: (reason: unknown) => void = () => {};
  const loadFailed = new Promise<never>((_, reject) => {
    failLoad = reject;
  });
  const ready = glue.default({
    noInitialRun: true,
    print: () => {},
    printErr: (line) => stderr.append(line),
    locateFile: (file) => `${wasmDir}${file}`,
    instantiateWasm(imports, done) {
      instantiate(`${wasmDir}qpdf.wasm`, imports)
        .then((instance) => done(instance))
        .catch(failLoad);
      return {};
    },
  });
  const qpdfModule = await Promise.race([ready, loadFailed]);
  return new EmscriptenQpdfRunner(qpdfModule, stderr);
}
