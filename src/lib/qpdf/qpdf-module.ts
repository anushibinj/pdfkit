/**
 * The parts of the qpdf WebAssembly build (`@jspawn/qpdf-wasm`, an
 * Emscripten "MODULARIZE" build of the qpdf command line tool) that the
 * tools use. Declared here so tests can pass fakes and so this module never
 * pulls in the binary.
 */

/** Emscripten's in-memory file system, as qpdf sees it. */
export interface QpdfFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  /** Throws when `path` does not exist. */
  stat(path: string): unknown;
}

/** One instantiated qpdf program. */
export interface QpdfModule {
  FS: QpdfFS;
  /**
   * Run qpdf like a command line (`qpdf ...args`).
   *
   * @returns The exit code: 0 success, 2 error, 3 success with warnings.
   */
  callMain(args: string[]): number;
}

/** Options the glue's factory accepts. */
export interface QpdfOptions {
  /** Do not run `main` on start-up; we call `callMain` ourselves. */
  noInitialRun: boolean;
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
  /**
   * Emscripten's hook for instantiating the binary ourselves. It must call
   * `done` with the instance and return `{}` synchronously.
   */
  instantiateWasm: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance) => void,
  ) => Record<string, never>;
}

/** What `qpdf.mjs` (copied to /wasm/) exports. */
export interface QpdfGlue {
  default: (options: QpdfOptions) => Promise<QpdfModule>;
}
