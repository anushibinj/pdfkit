import {
  EXIT_ERROR,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-output";
import type { QpdfRun } from "@/lib/qpdf/qpdf-runner";
import { planAssemblyJobs } from "../core/assembly-jobs";
import { formatPageRuns, toPageRuns } from "../core/page-ranges";

/**
 * What the assembler needs from qpdf. `QpdfRunner` provides it; tests pass
 * a fake.
 */
export interface QpdfCommands {
  run(args: string[]): QpdfRun;
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  exists(path: string): boolean;
  remove(path: string): void;
}

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
  /** One PDF per output, in plan order. */
  files: Uint8Array[];
  /** Distinct warnings, if qpdf had to repair something. */
  warnings: string[];
}

/** Called after each output file is made. */
export type AssemblyProgress = (done: number, total: number) => void;

/**
 * Builds output PDFs from pages of a source PDF with qpdf.
 *
 * Each output is made by
 *
 *     qpdf [--password=…] <input> --pages . <pages> -- <output>
 *
 * The "." makes the input the "primary" file, whose document-level data
 * qpdf keeps: the password and encryption, document information, and the
 * form fields that belong to the kept pages. qpdf writes only objects the
 * kept pages (and the document itself) still reach, so a page left out is
 * not written at all; anything that still referred to it, such as a
 * bookmark or a link, now points to a null object. None of its content ends
 * up in the file (checked in the integration test). Large splits go
 * through temporary parts (see `assembly-jobs.ts`), made by the same
 * command, so the result is identical either way.
 *
 * All files live in qpdf's in-memory file system under one job prefix and
 * are deleted when the call ends, whether it succeeded or not.
 */
export class PageAssembler {
  private jobCounter = 0;

  /**
   * @param qpdf The qpdf commands.
   * @param random Source of randomness for job names (injected for tests).
   */
  constructor(
    private readonly qpdf: QpdfCommands,
    private readonly random: () => number = Math.random,
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
    // Names follow the "/job-<id>-<role>.pdf" pattern on purpose:
    // friendlyQpdfMessage strips exactly that prefix from qpdf's messages.
    const job = `/job-${++this.jobCounter}-${this.random().toString(36).slice(2, 8)}`;
    const input = `${job}-in.pdf`;
    const part = `${job}-part.pdf`;
    const output = `${job}-out.pdf`;
    const files: Uint8Array[] = new Array(outputs.length);
    const warnings = new Set<string>();
    let done = 0;

    /**
     * Run one `--pages` command and check it worked.
     *
     * @param from The input file.
     * @param pages Page indices of `from`.
     * @param to Where to write.
     */
    const copyPages = (from: string, pages: readonly number[], to: string) => {
      const args = password ? [`--password=${password}`] : [];
      // qpdf wants 1-based ranges separated by plain commas: "1-3,5".
      args.push(from, "--pages", ".", formatPageRuns(toPageRuns(pages), ","), "--", to);
      const result = this.qpdf.run(args);
      if (result.code === EXIT_ERROR || !this.qpdf.exists(to)) {
        if (isInvalidPassword(result.stderr)) throw new WrongPasswordError();
        throw new AssemblyError(friendlyQpdfMessage(result.stderr));
      }
      if (result.code === EXIT_WARNINGS) {
        warnings.add(friendlyQpdfMessage(result.stderr));
      }
    };

    /**
     * Make one output file and keep its bytes.
     *
     * @param from The input file (source or part).
     * @param pages Page indices of `from`.
     * @param outputIndex Where the file goes in the result.
     */
    const makeOutput = (from: string, pages: readonly number[], outputIndex: number) => {
      copyPages(from, pages, output);
      // readFile returns a copy, so the file can be deleted right away and
      // the in-memory file system never holds more than one output.
      files[outputIndex] = this.qpdf.readFile(output);
      this.qpdf.remove(output);
      onProgress?.(++done, outputs.length);
    };

    try {
      this.qpdf.writeFile(input, source);
      for (const step of planAssemblyJobs(outputs, pageCount)) {
        if (step.kind === "direct") {
          makeOutput(input, step.pages, step.outputIndex);
          continue;
        }
        // Copy the stretch first...
        const stretch: number[] = [];
        for (let p = step.span.first; p <= step.span.last; p++) stretch.push(p);
        copyPages(input, stretch, part);
        // ...then make this group's outputs from the much smaller part.
        for (const out of step.outputs) makeOutput(part, out.pages, out.outputIndex);
        this.qpdf.remove(part);
      }
      return { files, warnings: [...warnings] };
    } finally {
      this.qpdf.remove(input);
      this.qpdf.remove(part);
      this.qpdf.remove(output);
    }
  }
}
