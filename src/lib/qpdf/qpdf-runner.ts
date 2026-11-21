import type { ConsoleCapture } from "./console-capture";
import type { QpdfModule } from "./qpdf-module";

/** What one qpdf command produced. */
export interface QpdfRun {
  /** 0 success, 2 error, 3 success with warnings (see `qpdf-output.ts`). */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Unique file names for one piece of work in qpdf's in-memory file system.
 *
 * Every name handed out is remembered, so {@link QpdfRunner.withJob} can
 * delete all of them afterwards. Names look like `/job-3-in.pdf`, the shape
 * `friendlyQpdfMessage` strips from qpdf's messages.
 */
export class QpdfJob {
  private readonly used: string[] = [];

  /** @param prefix Unique per job, e.g. "/job-3". */
  constructor(private readonly prefix: string) {}

  /**
   * Reserve a file name for this job.
   *
   * @param name A short name such as "in.pdf".
   * @returns The full path, e.g. "/job-3-in.pdf".
   */
  path(name: string): string {
    const path = `${this.prefix}-${name}`;
    if (!this.used.includes(path)) this.used.push(path);
    return path;
  }

  /** @returns Every path reserved so far. */
  paths(): readonly string[] {
    return this.used;
  }
}

/**
 * What code that drives qpdf needs: run commands and move files in and out
 * of its memory file system. Implemented by {@link QpdfRunner}; tests pass
 * fakes.
 */
export interface QpdfEngine {
  run(args: readonly string[]): QpdfRun;
  writeFile(path: string, bytes: Uint8Array): void;
  readFile(path: string): Uint8Array;
  exists(path: string): boolean;
  remove(path: string): void;
  withJob<T>(fn: (job: QpdfJob) => T): T;
}

/**
 * A ready qpdf instance: runs commands and moves files in and out of its
 * memory file system.
 */
export class QpdfRunner implements QpdfEngine {
  private jobs = 0;

  /**
   * @param module The instantiated qpdf program.
   * @param capture Where its console output lands (installed before the
   *   program was created).
   */
  constructor(
    private readonly module: QpdfModule,
    private readonly capture: ConsoleCapture,
  ) {}

  /**
   * Run one qpdf command and collect what it printed.
   *
   * @param args The arguments after `qpdf`, e.g. `["--decrypt", "a", "b"]`.
   * @returns The exit code and the output of this run only.
   */
  run(args: readonly string[]): QpdfRun {
    this.capture.reset();
    const code = this.module.callMain([...args]);
    return {
      code,
      stdout: this.capture.stdout(),
      stderr: this.capture.stderr(),
    };
  }

  /**
   * @param path Where to write.
   * @param bytes The file's content.
   */
  writeFile(path: string, bytes: Uint8Array): void {
    this.module.FS.writeFile(path, bytes);
  }

  /**
   * @param path The file to read.
   * @returns A new array with the file's content. Emscripten's
   *   `FS.readFile` copies the bytes out (checked in the glue), so the
   *   array stays valid after the file is deleted and its whole buffer can
   *   be transferred.
   */
  readFile(path: string): Uint8Array {
    return this.module.FS.readFile(path);
  }

  /**
   * @param path A file path.
   * @returns Whether the file exists.
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
   * Delete a file if it exists. Never throws: clean-up must not hide the
   * error that made it necessary.
   *
   * @param path A file path.
   */
  remove(path: string): void {
    try {
      if (this.exists(path)) this.module.FS.unlink(path);
    } catch {
      /* best-effort clean-up */
    }
  }

  /**
   * Run `fn` with fresh, unique file names and delete every file it
   * created afterwards, whether it returns or throws. Files are held in
   * WebAssembly memory, so a leaked one would cost memory until the worker
   * restarts.
   *
   * @param fn The work; reserves file names with `job.path(name)`.
   * @returns What `fn` returns.
   */
  withJob<T>(fn: (job: QpdfJob) => T): T {
    const job = new QpdfJob(`/job-${++this.jobs}`);
    try {
      return fn(job);
    } finally {
      for (const path of job.paths()) this.remove(path);
    }
  }
}
