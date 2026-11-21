import { formatPageRanges } from "@/lib/page-ranges";
import {
  EXIT_ERROR,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-output";
import { runQpdfJob, type QpdfJob } from "@/lib/qpdf/qpdf-job";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import {
  newScratchToken,
  removeScratchFiles,
  scratchFiles,
} from "@/lib/qpdf/scratch-files";
import { toTransferableBuffer } from "@/lib/transfer";
import { planAssemblyJobs } from "../core/assembly-jobs";

/** qpdf refused the password (it changed, or the file needs another). */
export class WrongPasswordError extends Error {
  constructor() {
    super("The password is not correct for this PDF.");
    this.name = "WrongPasswordError";
  }
}

/** qpdf could not make a file; the message is ready to show. */
export class AssemblyError extends Error {
  /** @param message A readable explanation (see `friendlyQpdfMessage`). */
  constructor(message: string) {
    super(message);
    this.name = "AssemblyError";
  }
}

/** The built files and anything qpdf warned about. */
export interface Assembly {
  /** One PDF per output, in plan order (each its own buffer). */
  files: Uint8Array[];
  /** Distinct warnings, if qpdf had to repair something. */
  warnings: string[];
}

/** Called after each output file is made. */
export type AssemblyProgress = (done: number, total: number) => void;

/**
 * The job that copies some pages of `from` into `to`.
 *
 * It is `qpdf [--password=...] <from> --pages . <range> -- <to>` written as
 * a job (see `runQpdfJob` for why JSON and not the command line). The "."
 * makes `from` the primary file, which is what makes the result keep the
 * source's password, document information and the form fields of the kept
 * pages (unlike `--empty`, which Merge PDFs uses on purpose to keep none).
 *
 * @param from The input file.
 * @param password Its password, or "" for none (left out of the job).
 * @param pages 0-based page indices of `from`, in output order.
 * @param to Where qpdf writes the result.
 * @returns The job description.
 */
export function copyPagesJob(
  from: string,
  password: string,
  pages: readonly number[],
  to: string,
): QpdfJob {
  return {
    inputFile: from,
    ...(password ? { password } : {}),
    // 1-based, plain commas, never a backwards run: "1-3,5".
    pages: [{ file: ".", range: formatPageRanges(pages) }],
    outputFile: to,
  };
}

/**
 * Builds output PDFs from pages of a source PDF with qpdf.
 *
 * qpdf writes only the objects the kept pages (and the document itself)
 * still reach, so a page left out is not written at all; anything that
 * still referred to it, such as a bookmark or a link, now points to a null
 * object. None of its content ends up in the file (checked in the
 * integration test). Large splits go through temporary parts (see
 * `assembly-jobs.ts`), made by the same job, so the result is identical.
 *
 * Single responsibility: decide which jobs to run, in which order, and read
 * their results. Running qpdf is delegated to a {@link QpdfRunner}
 * (injected, so the steps are tested with a fake). All files live in qpdf's
 * in-memory file system and are deleted when the call ends, whether it
 * succeeded or not.
 */
export class PageAssembler {
  /**
   * @param qpdf A loaded qpdf.
   * @param newToken Makes the job's file-name token (injected for tests).
   */
  constructor(
    private readonly qpdf: QpdfRunner,
    private readonly newToken: () => string = newScratchToken,
  ) {}

  /**
   * Build the output files.
   *
   * @param source The source PDF's bytes.
   * @param password The password it opens with, or "" for none.
   * @param pageCount Pages in the source.
   * @param outputs Source page indices per output (validated, non-empty).
   * @param onProgress Told after each output file.
   * @returns The files, in plan order, and any warnings.
   * @throws {WrongPasswordError} When qpdf refuses the password.
   * @throws {AssemblyError} When qpdf cannot make a file.
   */
  assemble(
    source: Uint8Array,
    password: string,
    pageCount: number,
    outputs: readonly (readonly number[])[],
    onProgress?: AssemblyProgress,
  ): Assembly {
    const token = this.newToken();
    // input, output and job JSON follow the shared naming, so
    // friendlyQpdfMessage strips them from qpdf's messages; the part (a
    // temporary stretch of the source) follows the same pattern.
    const files = scratchFiles(token);
    const part = `/job-${token}-part.pdf`;
    const results: Uint8Array[] = new Array(outputs.length);
    const warnings = new Set<string>();
    let done = 0;

    /**
     * Run one copy job and check it worked.
     *
     * @param from The input file.
     * @param pages Page indices of `from`.
     * @param to Where to write.
     */
    const copyPages = (from: string, pages: readonly number[], to: string) => {
      const run = runQpdfJob(
        this.qpdf,
        files.job,
        copyPagesJob(from, password, pages, to),
      );
      if (run.code === EXIT_ERROR || !this.qpdf.exists(to)) {
        if (isInvalidPassword(run.stderr)) throw new WrongPasswordError();
        throw new AssemblyError(friendlyQpdfMessage(run.stderr));
      }
      if (run.code === EXIT_WARNINGS) {
        warnings.add(friendlyQpdfMessage(run.stderr));
      }
    };

    /**
     * Make one output file and keep its bytes.
     *
     * @param from The input file (source or part).
     * @param pages Page indices of `from`.
     * @param outputIndex Where the file goes in the result.
     */
    const makeOutput = (
      from: string,
      pages: readonly number[],
      outputIndex: number,
    ) => {
      copyPages(from, pages, files.output);
      // QpdfRunner.readFile may return a view into WebAssembly memory:
      // toTransferableBuffer copies it only in that case, so each result is
      // its own buffer and the output file can be deleted at once (the
      // in-memory file system never holds more than one output).
      results[outputIndex] = new Uint8Array(
        toTransferableBuffer(this.qpdf.readFile(files.output)),
      );
      this.qpdf.remove(files.output);
      onProgress?.(++done, outputs.length);
    };

    try {
      this.qpdf.writeFile(files.input, source);
      for (const step of planAssemblyJobs(outputs, pageCount)) {
        if (step.kind === "direct") {
          makeOutput(files.input, step.pages, step.outputIndex);
          continue;
        }
        // Copy the stretch first...
        const stretch: number[] = [];
        for (let p = step.span.first; p <= step.span.last; p++) stretch.push(p);
        copyPages(files.input, stretch, part);
        // ...then make this group's outputs from the much smaller part,
        // which keeps the source's password, so the same one opens it.
        for (const out of step.outputs) {
          makeOutput(part, out.pages, out.outputIndex);
        }
        this.qpdf.remove(part);
      }
      return { files: results, warnings: [...warnings] };
    } finally {
      removeScratchFiles(this.qpdf, files);
      this.qpdf.remove(part);
    }
  }
}
