import type { QpdfRunner } from "./qpdf-runner";

/** Paths in qpdf's in-memory file system used by one job. */
export interface ScratchFiles {
  /** The PDF to process. */
  readonly input: string;
  /** Where qpdf writes its result. */
  readonly output: string;
  /** A job JSON file (see `runQpdfJob`). */
  readonly job: string;
}

let sequence = 0;

/**
 * Make a token that is unique within this worker, for naming one job's files.
 *
 * The counter alone guarantees uniqueness; the random suffix only makes the
 * names harder to mix up when reading logs. This is not a security measure:
 * the file system is private to the worker.
 *
 * @param random Source of randomness in [0, 1) (injected by tests).
 * @returns A token such as "4-k3j9xq".
 */
export function newScratchToken(random: () => number = Math.random): string {
  return `${++sequence}-${random().toString(36).slice(2, 8)}`;
}

/**
 * Name one job's files.
 *
 * The PDFs are named "/job-<token>-in.pdf" and "/job-<token>-out.pdf" because
 * `friendlyQpdfMessage` strips exactly that pattern from qpdf's messages.
 *
 * @param token From {@link newScratchToken}.
 * @returns The input, output and job JSON paths.
 */
export function scratchFiles(token: string): ScratchFiles {
  return {
    input: `/job-${token}-in.pdf`,
    output: `/job-${token}-out.pdf`,
    job: `/job-${token}-job.json`,
  };
}

/**
 * Delete every file of a job, ignoring the ones that were never created.
 * Called from `finally` so input PDFs, results and job JSON (which holds
 * passwords) never outlive the job.
 *
 * @param runner A loaded qpdf.
 * @param files The job's files.
 */
export function removeScratchFiles(
  runner: QpdfRunner,
  files: ScratchFiles,
): void {
  runner.remove(files.input);
  runner.remove(files.output);
  runner.remove(files.job);
}
