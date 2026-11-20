/** The two console methods qpdf writes its output through. */
export type CapturableConsole = Pick<Console, "log" | "warn">;

/**
 * Collects what qpdf prints, so a run's messages can be read afterwards.
 *
 * The qpdf build ignores Emscripten's `print`/`printErr` options: when its
 * factory runs it binds `console.log` (stdout) and `console.warn` (stderr)
 * as they are at that moment. Installing capturing functions on the console
 * *before* the factory runs is therefore the only way to read qpdf's
 * messages, such as "invalid password". In a worker that console belongs to
 * the worker alone, so the page's console is unaffected.
 *
 * Runs are synchronous and a worker handles one request at a time, so one
 * capture per worker is enough: {@link reset} before a run, read after it.
 */
export class ConsoleCapture {
  private out: string[] = [];
  private err: string[] = [];

  /**
   * Route `target.log` and `target.warn` into this capture.
   *
   * Calling it again (for example when qpdf is reloaded after a crash)
   * installs new functions that write into the same buffers, so functions
   * an earlier qpdf instance bound keep working too.
   *
   * @param target The console qpdf will bind (the worker's global console).
   */
  install(target: CapturableConsole): void {
    target.log = (...args: unknown[]) => this.writeOut(join(args));
    target.warn = (...args: unknown[]) => this.writeErr(join(args));
  }

  /** Forget everything captured so far (call before each run). */
  reset(): void {
    this.out = [];
    this.err = [];
  }

  /** @param line One line of standard output. */
  writeOut(line: string): void {
    this.out.push(line);
  }

  /** @param line One line of standard error. */
  writeErr(line: string): void {
    this.err.push(line);
  }

  /** @returns Standard output since the last reset, one line per entry. */
  stdout(): string {
    return this.out.join("\n");
  }

  /** @returns Standard error since the last reset, one line per entry. */
  stderr(): string {
    return this.err.join("\n");
  }
}

/**
 * Join console arguments the way the console prints them, separated by
 * spaces.
 *
 * @param args The arguments of one console call.
 * @returns One line of text.
 */
function join(args: unknown[]): string {
  return args.map(String).join(" ");
}
