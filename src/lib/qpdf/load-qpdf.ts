import type { ModuleImporter } from "@/lib/module-importer";
import { ConsoleCapture, type CapturableConsole } from "./console-capture";
import type { WasmInstantiator } from "./instantiate-wasm";
import type { QpdfGlue } from "./qpdf-module";
import { QpdfRunner } from "./qpdf-runner";

/** Everything {@link loadQpdf} needs from its environment. */
export interface QpdfLoadDeps {
  /** Performs the dynamic import of the glue. */
  importer: ModuleImporter;
  /** Instantiates the binary (see `instantiateFromUrl`). */
  instantiate: WasmInstantiator;
  /** The console qpdf binds for its output (the worker's global console). */
  console: CapturableConsole;
}

/**
 * One capture per JavaScript realm. qpdf instances bind the console
 * functions once, so every instance in this worker, including one created
 * again after a crash, must write into the same buffers.
 */
const capture = new ConsoleCapture();

/**
 * Load and instantiate qpdf from our own origin.
 *
 * Steps, and why:
 * 1. Install the console capture first. The build binds `console.log` and
 *    `console.warn` when its factory runs (see {@link ConsoleCapture}).
 * 2. Import the glue (`qpdf.mjs`), a static file under `wasmDir` copied
 *    there by `scripts/copy-wasm.mjs`, never part of the bundle.
 * 3. Call the factory with our own `instantiateWasm`, so the binary comes
 *    from `wasmDir` as well.
 * 4. Race the factory's promise against a "load failed" promise. If
 *    instantiating fails, Emscripten never calls `done`, and its promise
 *    would stay pending forever; the race turns that into a rejection the
 *    caller can report and retry.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param deps The importer, instantiator and console (injected for tests).
 * @returns A runner for the new instance.
 */
export async function loadQpdf(
  wasmDir: string,
  deps: QpdfLoadDeps,
): Promise<QpdfRunner> {
  capture.install(deps.console);
  const glue = (await deps.importer(`${wasmDir}qpdf.mjs`)) as QpdfGlue;
  let failLoad: (reason: unknown) => void = () => {};
  const loadFailed = new Promise<never>((_, reject) => {
    failLoad = reject;
  });
  const ready = glue.default({
    noInitialRun: true,
    print: (line) => capture.writeOut(line),
    printErr: (line) => capture.writeErr(line),
    locateFile: (file) => `${wasmDir}${file}`,
    instantiateWasm(imports, done) {
      deps.instantiate(imports).then(done, failLoad);
      return {};
    },
  });
  const program = await Promise.race([ready, loadFailed]);
  return new QpdfRunner(program, capture);
}
