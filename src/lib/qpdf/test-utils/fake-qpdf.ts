/**
 * Test-only in-memory {@link QpdfRunner}: a file map plus a scripted `run`.
 */
import type { QpdfRun, QpdfRunner } from "../qpdf-runner";

/** Decides what one `run` call returns; may read and write `files`. */
export type RunScript = (
  args: readonly string[],
  files: Map<string, Uint8Array>,
) => QpdfRun;

export class FakeQpdfRunner implements QpdfRunner {
  /** The in-memory file system. */
  readonly files = new Map<string, Uint8Array>();
  /** Every `run` call's arguments, in order. */
  readonly runs: string[][] = [];
  /**
   * Snapshot of the job JSON for each `--job-json-file=` run, parsed, taken
   * while the file still exists (`runQpdfJob` deletes it afterwards).
   */
  readonly jobs: unknown[] = [];

  /**
   * @param script Produces each run's result (default: exit 0, no output).
   */
  constructor(
    private readonly script: RunScript = () => ({ code: 0, stderr: "" }),
  ) {}

  /**
   * Record the call (and the job JSON, if any), then delegate to the script.
   *
   * @param args The arguments.
   * @returns The script's result.
   */
  run(args: readonly string[]): QpdfRun {
    this.runs.push([...args]);
    const jobArg = args.find((a) => a.startsWith("--job-json-file="));
    if (jobArg) {
      const bytes = this.files.get(jobArg.slice("--job-json-file=".length));
      this.jobs.push(
        bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined,
      );
    }
    return this.script(args, this.files);
  }

  /**
   * @param path Absolute path.
   * @param data Bytes (copied, like Emscripten's FS does).
   */
  writeFile(path: string, data: Uint8Array): void {
    this.files.set(path, data.slice());
  }

  /**
   * @param path Absolute path.
   * @returns The bytes.
   */
  readFile(path: string): Uint8Array {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT: ${path}`);
    return data;
  }

  /**
   * @param path Absolute path.
   * @returns Whether it exists.
   */
  exists(path: string): boolean {
    return this.files.has(path);
  }

  /**
   * @param path Absolute path (missing paths are ignored).
   */
  remove(path: string): void {
    this.files.delete(path);
  }
}
