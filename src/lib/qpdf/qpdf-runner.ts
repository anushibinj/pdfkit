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
  /**
   * Everything qpdf wrote to stdout during this run, one line per `\n`
   * (for example the count printed by `--show-npages`). Only present when
   * the runner captures stdout: see `QpdfLoadOptions.stdout`. Most commands
   * print nothing there, so most tools leave it off.
   */
  stdout?: string;
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
 * Collects the lines qpdf prints to one of its output streams.
 *
 * This qpdf build writes stderr through `console.warn` and stdout through
 * `console.log` (see `load-qpdf.ts`), so the loader points those at
 * {@link StderrLog.append}: always for stderr, and for stdout when a tool asks
 * for it (a second instance of this class). A run clears the log first, so
 * each {@link QpdfRun} carries only its own output.
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
   * @param stdout The log that receives qpdf's stdout lines, when the tool
   *   reads stdout; without it, results carry no `stdout`.
   */
  constructor(
    private readonly module: QpdfModule,
    private readonly stderr: StderrLog,
    private readonly stdout?: StderrLog,
  ) {}

  /**
   * Run qpdf. `callMain` is synchronous: the module runs to completion
   * before it returns, so the logs hold exactly this run's output afterwards.
   * The arguments are copied because Emscripten's `callMain` is typed to take
   * a mutable array.
   *
   * @param args Arguments, without the program name.
   * @returns The exit code, this run's stderr and, when captured, its stdout.
   */
  run(args: readonly string[]): QpdfRun {
    this.stderr.clear();
    this.stdout?.clear();
    const code = this.module.callMain([...args]);
    const stderr = this.stderr.text();
    return this.stdout
      ? { code, stderr, stdout: this.stdout.text() }
      : { code, stderr };
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
