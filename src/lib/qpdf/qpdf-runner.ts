/**
 * Loading qpdf (compiled to WebAssembly by `@jspawn/qpdf-wasm`) and running
 * its command line inside a Web Worker. Shared by every qpdf-based tool.
 *
 * qpdf is a command-line program, so it is driven like one: input files are
 * written into Emscripten's in-memory file system, `callMain` runs one
 * command line, and output files are read back. Nothing touches a disk.
 */

/** The Emscripten in-memory file system calls the tools use. */
export interface QpdfFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  stat(path: string): unknown;
}

/** An instantiated qpdf module. */
export interface QpdfModule {
  FS: QpdfFS;
  /** Run qpdf with these arguments (no program name) and return its exit code. */
  callMain(args: string[]): number;
}

/** Options the glue's factory accepts (Emscripten `Module` overrides). */
export interface QpdfOptions {
  noInitialRun: boolean;
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
  instantiateWasm: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance) => void,
  ) => Record<string, never>;
}

/** The glue's default export. */
export type QpdfFactory = (options: QpdfOptions) => Promise<QpdfModule>;

/** What one qpdf command line produced. */
export interface QpdfRun {
  /** Exit code: see `EXIT_OK`, `EXIT_ERROR`, `EXIT_WARNINGS`. */
  code: number;
  /** Everything qpdf wrote to stderr during this run, one line per line. */
  stderr: string;
}

/** Imports a module by URL; a worker passes a real dynamic `import()`. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * Collects the lines qpdf writes to stderr, one command line at a time.
 */
export class StderrCapture {
  private lines: string[] = [];

  /**
   * Record one line of output.
   *
   * @param line The text qpdf wrote.
   */
  push(line: string): void {
    this.lines.push(line);
  }

  /** Forget everything recorded so far (called before each run). */
  reset(): void {
    this.lines = [];
  }

  /** @returns The recorded lines, joined with newlines. */
  text(): string {
    return this.lines.join("\n");
  }
}

/**
 * A loaded qpdf: runs one command line at a time and gives access to its
 * in-memory file system.
 *
 * Every file helper is deliberately small and synchronous, like the
 * Emscripten calls behind it, so callers can clean up in `finally` blocks.
 */
export class QpdfRunner {
  /**
   * Use {@link loadQpdf}.
   *
   * @param module The instantiated qpdf module.
   * @param stderr Where the module's stderr lines are collected.
   */
  constructor(
    private readonly module: QpdfModule,
    private readonly stderr: StderrCapture,
  ) {}

  /**
   * Run one qpdf command line.
   *
   * The capture is cleared first, so the returned stderr belongs to this
   * run only.
   *
   * @param args Arguments, without the program name.
   * @returns The exit code and this run's stderr.
   */
  run(args: string[]): QpdfRun {
    this.stderr.reset();
    const code = this.module.callMain(args);
    return { code, stderr: this.stderr.text() };
  }

  /**
   * Write a file into the in-memory file system (replacing any old one).
   *
   * @param path Absolute path, e.g. "/job-1-in.pdf".
   * @param data The file's bytes.
   */
  writeFile(path: string, data: Uint8Array): void {
    this.module.FS.writeFile(path, data);
  }

  /**
   * Read a file from the in-memory file system.
   *
   * @param path Absolute path.
   * @returns A new array holding a copy of the file (Emscripten's
   *   `FS.readFile` allocates it), so it stays valid after the file is
   *   deleted and its buffer can be transferred.
   */
  readFile(path: string): Uint8Array {
    return this.module.FS.readFile(path);
  }

  /**
   * @param path Absolute path.
   * @returns Whether a file exists there.
   */
  exists(path: string): boolean {
    try {
      this.module.FS.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file if it exists. Never throws: it runs in clean-up code,
   * where a second error would hide the first one.
   *
   * @param path Absolute path.
   */
  remove(path: string): void {
    try {
      if (this.exists(path)) this.module.FS.unlink(path);
    } catch {
      /* best effort cleanup */
    }
  }
}

/** Everything {@link loadQpdf} needs from its environment (injected for tests). */
export interface QpdfLoaderDeps {
  /** Absolute URL of the directory holding qpdf.mjs and qpdf.wasm, ending in "/". */
  wasmDir: string;
  /** Performs the dynamic import of the glue. */
  importer: ModuleImporter;
  /** The worker's console; its `warn` and `log` are replaced (see below). */
  console: Pick<Console, "warn" | "log">;
  /** Downloads the binary. */
  fetch: (url: string) => Promise<Response>;
  /** Compiles and instantiates the binary. */
  wasm: Pick<typeof WebAssembly, "instantiateStreaming" | "instantiate">;
}

/**
 * Load qpdf from our own origin (/wasm/, never a CDN) and wrap it in a
 * {@link QpdfRunner}.
 *
 * Three details matter:
 * 1. This qpdf build ignores the `print`/`printErr` options for most of its
 *    output and binds `console.log`/`console.warn` while its glue is being
 *    evaluated. So capturing versions are installed *before* the import:
 *    `warn` feeds the stderr capture, `log` (stdout) is dropped. This is a
 *    worker, so the page's console is unaffected.
 * 2. The binary is instantiated with `instantiateStreaming` (compiles while
 *    downloading). Hosts that do not serve `application/wasm` make that
 *    reject, so it falls back to downloading the bytes and `instantiate`.
 * 3. Emscripten's `instantiateWasm` hook reports failure by never calling
 *    `done`, which would leave the factory's promise pending forever. A
 *    second promise (`loadFailed`) is rejected on failure and raced against
 *    the factory, so a failed download rejects instead of hanging.
 *
 * @param deps The environment.
 * @returns A ready runner.
 * @throws When the glue or the binary cannot be loaded.
 */
export async function loadQpdf(deps: QpdfLoaderDeps): Promise<QpdfRunner> {
  const { wasmDir } = deps;
  const stderr = new StderrCapture();
  deps.console.warn = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  deps.console.log = () => {};
  const glue = (await deps.importer(`${wasmDir}qpdf.mjs`)) as {
    default: QpdfFactory;
  };
  let failLoad: (reason: unknown) => void = () => {};
  const loadFailed = new Promise<never>((_, reject) => {
    failLoad = reject;
  });
  const ready = glue.default({
    noInitialRun: true,
    print: () => {},
    printErr: (line) => stderr.push(line),
    locateFile: (file) => `${wasmDir}${file}`,
    instantiateWasm(imports, done) {
      const url = `${wasmDir}qpdf.wasm`;
      deps.wasm
        .instantiateStreaming(deps.fetch(url), imports)
        .catch(async () => {
          // Fallback for hosts that do not serve application/wasm.
          const bytes = await (await deps.fetch(url)).arrayBuffer();
          return deps.wasm.instantiate(bytes, imports);
        })
        .then(({ instance }) => done(instance))
        .catch(failLoad);
      return {};
    },
  });
  return new QpdfRunner(await Promise.race([ready, loadFailed]), stderr);
}
