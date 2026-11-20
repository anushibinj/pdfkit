/**
 * The slice of the qpdf WebAssembly build (`@jspawn/qpdf-wasm`, the qpdf
 * command line compiled with Emscripten) that pdfkit uses.
 *
 * Declared here instead of imported because the package ships no types, and
 * so that tests can fake exactly this surface without loading the binary.
 */

/** The in-memory virtual file system qpdf reads its input from and writes to. */
export interface QpdfFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  /** Throws when `path` does not exist. */
  stat(path: string): unknown;
}

/** An instantiated qpdf module. */
export interface QpdfModule {
  FS: QpdfFS;
  /**
   * Run the qpdf command line with `args` (without the program name) and
   * return its exit code. Synchronous: it blocks until qpdf finishes.
   */
  callMain(args: string[]): number;
}

/**
 * Options for the Emscripten factory.
 *
 * The build ignores `print`/`printErr`, so there are none here: qpdf's
 * stdout and stderr are read through `console.log`/`console.warn` instead
 * (see `QpdfOutput`).
 */
export interface QpdfFactoryOptions {
  /** Do not run `main()` on load; commands are run with `callMain`. */
  noInitialRun: true;
  /** Where Emscripten finds auxiliary files. */
  locateFile(file: string): string;
  /**
   * Take over WebAssembly instantiation. Must call `done` with the instance
   * and synchronously return `{}` (Emscripten's "async instantiation" signal).
   */
  instantiateWasm(
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance) => void,
  ): Record<string, never>;
}

/** The Emscripten factory exported by the glue (`qpdf.mjs` / `qpdf.js`). */
export type QpdfFactory = (options: QpdfFactoryOptions) => Promise<QpdfModule>;
