/**
 * A small, tool-agnostic interface over the qpdf command line compiled to
 * WebAssembly, plus its implementation on top of the Emscripten module.
 *
 * Tools depend on {@link QpdfRunner}, not on Emscripten, so their logic can be
 * unit tested with a fake and the engine can be replaced without touching them.
 */

/** The outcome of one qpdf invocation. */
export interface QpdfRun {
  /** Process exit code (see `EXIT_*` in `qpdf-output.ts`). */
  code: number;
  /** Everything qpdf wrote to stderr during this run, one line per `\n`. */
  stderr: string;
}

/**
 * What a tool needs from a loaded qpdf: run commands against a private,
 * in-memory file system.
 */
export interface QpdfRunner {
  /**
   * Run qpdf once, like `qpdf <args...>` on a command line.
   *
   * @param args Arguments, without the program name.
   * @returns The exit code and the stderr of this run only.
   */
  run(args: readonly string[]): QpdfRun;
  /**
   * Create or replace a file in the in-memory file system.
   *
   * @param path Absolute path, for example "/job-1-in.pdf".
   * @param data The file's bytes.
   */
  writeFile(path: string, data: Uint8Array): void;
  /**
   * Read a file from the in-memory file system.
   *
   * @param path Absolute path.
   * @returns The file's bytes. The view may point into WebAssembly memory, so
   *   copy it (see `toTransferableBuffer`) before transferring it.
   * @throws When the file does not exist.
   */
  readFile(path: string): Uint8Array;
  /**
   * Check whether a file exists.
   *
   * @param path Absolute path.
   * @returns `true` if it exists.
   */
  exists(path: string): boolean;
  /**
   * Delete a file if it exists. Never throws: it is used for clean-up in
   * `finally` blocks, where a second error would hide the first.
   *
   * @param path Absolute path.
   */
  remove(path: string): void;
}

/** The parts of Emscripten's `FS` object that qpdf tools use. */
export interface QpdfFileSystem {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  /** Throws when the path does not exist. */
  stat(path: string): unknown;
}

/** The parts of the Emscripten-generated qpdf module that tools use. */
export interface QpdfModule {
  FS: QpdfFileSystem;
  /** Runs qpdf's `main()` with the given arguments and returns its exit code. */
  callMain(args: string[]): number;
}

/**
 * Collects the lines qpdf prints to stderr.
 *
 * This qpdf build writes stderr through `console.warn` (see `load-qpdf.ts`),
 * so the loader points that at {@link StderrLog.append}. A run clears the log
 * first, so each {@link QpdfRun} carries only its own messages.
 */
export class StderrLog {
  private lines: string[] = [];

  /**
   * Record one line of output.
   *
   * @param line The text qpdf printed.
   */
  append(line: string): void {
    this.lines.push(line);
  }

  /** Forget everything recorded so far. */
  clear(): void {
    this.lines = [];
  }

  /**
   * Read what was recorded since the last {@link clear}.
   *
   * @returns The lines joined with "\n" ("" when nothing was printed).
   */
  text(): string {
    return this.lines.join("\n");
  }
}

/** {@link QpdfRunner} backed by the Emscripten qpdf module. */
export class EmscriptenQpdfRunner implements QpdfRunner {
  /**
   * @param module The instantiated qpdf module.
   * @param stderr The log that receives qpdf's stderr lines.
   */
  constructor(
    private readonly module: QpdfModule,
    private readonly stderr: StderrLog,
  ) {}

  /**
   * Run qpdf. `callMain` is synchronous: the module runs to completion
   * before it returns, so the log holds exactly this run's output afterwards.
   * The arguments are copied because Emscripten's `callMain` is typed to take
   * a mutable array.
   *
   * @param args Arguments, without the program name.
   * @returns The exit code and this run's stderr.
   */
  run(args: readonly string[]): QpdfRun {
    this.stderr.clear();
    const code = this.module.callMain([...args]);
    return { code, stderr: this.stderr.text() };
  }

  /**
   * @param path Absolute path.
   * @param data The file's bytes.
   */
  writeFile(path: string, data: Uint8Array): void {
    this.module.FS.writeFile(path, data);
  }

  /**
   * @param path Absolute path.
   * @returns The file's bytes.
   */
  readFile(path: string): Uint8Array {
    return this.module.FS.readFile(path);
  }

  /**
   * Emscripten has no `exists`; `stat` throws for a missing path, so a
   * successful `stat` means the file exists.
   *
   * @param path Absolute path.
   * @returns `true` if it exists.
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
   * Best-effort delete: a failure here must not mask the error of the work
   * that is being cleaned up after.
   *
   * @param path Absolute path.
   */
  remove(path: string): void {
    try {
      if (this.exists(path)) this.module.FS.unlink(path);
    } catch {
      /* best effort clean-up */
    }
  }
}
