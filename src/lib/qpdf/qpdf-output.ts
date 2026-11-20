/** The two console methods the qpdf build writes its output through. */
export interface ConsoleLike {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
}

/**
 * Collects what qpdf prints: stdout (for example the page count from
 * `--show-npages`) and stderr (errors and warnings).
 *
 * Why this exists: the qpdf WebAssembly build ignores Emscripten's `print`
 * and `printErr` options. Instead, its factory runs
 * `console.log.bind(console)` and `console.warn.bind(console)` and writes
 * stdout and stderr through those bound copies. Because they are bound
 * copies, replacing `console.log` later has no effect on them; the only way
 * to read qpdf's output is to put forwarders on the console *before* the
 * factory runs. {@link attachTo} installs those forwarders; they append to
 * this object's buffers, which {@link reset} clears before each command.
 */
export class QpdfOutput {
  private stdoutLines: string[] = [];
  private stderrLines: string[] = [];

  /**
   * Replace `target.log` and `target.warn` with forwarders into this object.
   *
   * Must be called before the qpdf factory runs (see the class comment).
   * Each console call becomes one line; its arguments are joined with spaces,
   * as the console itself would print them.
   *
   * @param target The console qpdf will bind, normally the global `console`.
   * @returns A function that puts the original methods back (used by tests;
   *   a dedicated qpdf worker keeps the forwarders for its whole life).
   */
  attachTo(target: ConsoleLike): () => void {
    const original = { log: target.log, warn: target.warn };
    const line = (data: unknown[]) => data.map(String).join(" ");
    target.log = (...data: unknown[]) => {
      this.stdoutLines.push(line(data));
    };
    target.warn = (...data: unknown[]) => {
      this.stderrLines.push(line(data));
    };
    return () => {
      target.log = original.log;
      target.warn = original.warn;
    };
  }

  /** Forget everything collected so far (call before each command). */
  reset(): void {
    this.stdoutLines = [];
    this.stderrLines = [];
  }

  /** @returns stdout since the last {@link reset}, one line per print. */
  stdout(): string {
    return this.stdoutLines.join("\n");
  }

  /** @returns stderr since the last {@link reset}, one line per print. */
  stderr(): string {
    return this.stderrLines.join("\n");
  }
}
