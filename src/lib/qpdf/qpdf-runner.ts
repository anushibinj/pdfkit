import type { QpdfFS, QpdfModule } from "./qpdf-module";
import type { QpdfOutput } from "./qpdf-output";

/** What one qpdf command produced. */
export interface QpdfRunResult {
  /** Exit code: see `EXIT_OK`, `EXIT_ERROR` and `EXIT_WARNINGS`. */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * The files of one job in qpdf's virtual file system.
 *
 * Callers name files ("in.pdf", "out.pdf"); the workspace turns each name into
 * a path unique to the job, so two jobs can never read each other's files.
 */
export interface QpdfWorkspace {
  /**
   * @param name A plain file name: letters, digits, ".", "_" and "-" only.
   * @returns The absolute virtual path for `name` in this job.
   */
  path(name: string): string;
  /**
   * Write a file into the job.
   *
   * @param name A plain file name.
   * @param bytes The content.
   * @returns The file's absolute virtual path (to pass to qpdf).
   */
  write(name: string, bytes: Uint8Array): string;
  /**
   * @param name A plain file name.
   * @returns The file's content.
   * @throws When the file does not exist.
   */
  read(name: string): Uint8Array;
  /**
   * @param name A plain file name.
   * @returns Whether qpdf (or the caller) created the file.
   */
  exists(name: string): boolean;
}

/** Runs qpdf commands. Tools depend on this, not on the WebAssembly module. */
export interface QpdfCommands {
  /**
   * Run one qpdf command line.
   *
   * @param args The arguments, without the program name.
   * @returns The exit code and what qpdf printed.
   */
  run(args: readonly string[]): QpdfRunResult;
  /**
   * Run `fn` with a fresh workspace and delete every file it created
   * afterwards, whether `fn` returns or throws.
   *
   * @param fn Receives the workspace.
   * @returns What `fn` returns.
   */
  withJob<T>(fn: (job: QpdfWorkspace) => T): T;
}

/** File names a job may use: no slashes, so no escaping the job's prefix. */
const SAFE_NAME = /^[\w.-]+$/;

/**
 * {@link QpdfWorkspace} that records every path it hands out, so
 * {@link dispose} can delete them all.
 */
export class QpdfJob implements QpdfWorkspace {
  private readonly paths = new Set<string>();

  /**
   * @param fs qpdf's virtual file system.
   * @param prefix Unique per job, e.g. "/job-3"; paths are "<prefix>-<name>".
   */
  constructor(
    private readonly fs: QpdfFS,
    private readonly prefix: string,
  ) {}

  /**
   * Turn a file name into this job's path for it, and remember the path so
   * {@link dispose} deletes the file if qpdf creates it.
   *
   * @inheritdoc
   */
  path(name: string): string {
    if (!SAFE_NAME.test(name))
      throw new Error(`Invalid job file name: ${name}`);
    const path = `${this.prefix}-${name}`;
    // Tracked even if never written: qpdf may create it (an output file).
    this.paths.add(path);
    return path;
  }

  /**
   * Write `bytes` to this job's file `name`.
   *
   * @inheritdoc
   */
  write(name: string, bytes: Uint8Array): string {
    const path = this.path(name);
    this.fs.writeFile(path, bytes);
    return path;
  }

  /**
   * Read this job's file `name`.
   *
   * @inheritdoc
   */
  read(name: string): Uint8Array {
    return this.fs.readFile(this.path(name));
  }

  /**
   * Check whether this job's file `name` exists.
   *
   * @inheritdoc
   */
  exists(name: string): boolean {
    return this.pathExists(this.path(name));
  }

  /**
   * Delete every file of this job that exists. Best effort: a failure to
   * delete one file (which would only waste memory) never hides the job's
   * real result or error, and does not stop the others from being deleted.
   */
  dispose(): void {
    for (const path of this.paths) {
      try {
        if (this.pathExists(path)) this.fs.unlink(path);
      } catch {
        /* best effort cleanup */
      }
    }
    this.paths.clear();
  }

  /**
   * @param path An absolute virtual path.
   * @returns Whether it exists (Emscripten's `stat` throws when it does not).
   */
  private pathExists(path: string): boolean {
    try {
      this.fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }
}

/** {@link QpdfCommands} backed by the real qpdf WebAssembly module. */
export class QpdfRunner implements QpdfCommands {
  private jobCount = 0;

  /**
   * @param qpdf The instantiated module.
   * @param output Must already be attached to the console qpdf bound.
   */
  constructor(
    private readonly qpdf: QpdfModule,
    private readonly output: QpdfOutput,
  ) {}

  /**
   * Run one command and collect only its own output.
   *
   * `callMain` is synchronous, so nothing else can print between the reset
   * and the reads: the result holds exactly this command's output. The
   * arguments are copied because Emscripten keeps no promise not to touch
   * the array it is given.
   *
   * @inheritdoc
   */
  run(args: readonly string[]): QpdfRunResult {
    this.output.reset();
    const code = this.qpdf.callMain([...args]);
    return { code, stdout: this.output.stdout(), stderr: this.output.stderr() };
  }

  /**
   * Job prefixes count up ("/job-1", "/job-2", ...) and are never reused
   * within one module instance, so a job can never pick up a file a
   * previous job failed to delete.
   *
   * @inheritdoc
   */
  withJob<T>(fn: (job: QpdfWorkspace) => T): T {
    const job = new QpdfJob(this.qpdf.FS, `/job-${++this.jobCount}`);
    try {
      return fn(job);
    } finally {
      job.dispose();
    }
  }
}
