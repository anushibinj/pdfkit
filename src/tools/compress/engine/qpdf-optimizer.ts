/**
 * qpdf lossless structural optimizer and decryption helper.
 *
 * Follows Single Responsibility Principle (SRP) and Dependency Inversion Principle (DIP):
 * operates strictly against {@link QpdfRunner} so it can be unit tested with `FakeQpdfRunner`
 * and executes Issue #20's recommended lossless pass:
 * `--object-streams=generate --recompress-flate --compression-level=9 --remove-unreferenced-resources=yes`.
 */

import { probeEncryption } from "@/lib/qpdf/encryption-status";
import { runQpdfJob } from "@/lib/qpdf/qpdf-job";
import { EXIT_OK, EXIT_WARNINGS } from "@/lib/qpdf/qpdf-output";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { removeScratchFiles, scratchFiles } from "@/lib/qpdf/scratch-files";

/** Result of probing and optionally decrypting an input PDF prior to compression. */
export type PreparePdfResult =
  | {
      status: "ok";
      /** Unencrypted PDF bytes ready for structural and image optimization. */
      bytes: Uint8Array;
      /** True if the input originally had owner restrictions or a user password. */
      wasEncrypted: boolean;
    }
  | {
      status: "password-required";
      /** True when a user-supplied password was rejected. */
      wrongPassword: boolean;
    }
  | {
      status: "unreadable";
      /** Explanation of why qpdf could not open the file. */
      message: string;
    };

/**
 * Wraps `qpdf` WebAssembly operations for decryption and lossless object-stream
 * optimization.
 */
export class QpdfLosslessOptimizer {
  private jobSeq = 0;

  /**
   * @param runner Abstract qpdf runner (real Emscripten module or fake in tests).
   */
  constructor(private readonly runner: QpdfRunner) {}

  /**
   * Probes encryption status and decrypts the PDF in memory if it has owner
   * restrictions or a user-supplied open password.
   *
   * Why we decrypt first: `lopdf` and `pdf-compress.wasm` refuse encrypted PDFs
   * so protection is never silently corrupted or dropped. Unlocking via qpdf's
   * job JSON ensures passwords containing special characters (`@`, `--`) work safely.
   *
   * @param bytes Raw input PDF bytes.
   * @param password Optional open password typed by the user.
   * @returns {@link PreparePdfResult}.
   */
  probeAndDecryptIfNeeded(
    bytes: Uint8Array,
    password?: string,
  ): PreparePdfResult {
    const files = scratchFiles(`cmp-prep-${++this.jobSeq}`);
    this.runner.writeFile(files.input, bytes);

    try {
      const probe = probeEncryption(this.runner, files.input);

      if (probe.kind === "unreadable") {
        return { status: "unreadable", message: probe.message };
      }

      if (probe.kind === "not-encrypted") {
        return { status: "ok", bytes, wasEncrypted: false };
      }

      if (probe.kind === "password-required" && !password) {
        return { status: "password-required", wrongPassword: false };
      }

      const run = runQpdfJob(this.runner, files.job, {
        inputFile: files.input,
        outputFile: files.output,
        password: password ?? "",
        suppressPasswordRecovery: "",
      });

      if (run.code !== EXIT_OK && run.code !== EXIT_WARNINGS) {
        if (probe.kind === "password-required") {
          return { status: "password-required", wrongPassword: true };
        }
        return {
          status: "unreadable",
          message: "Could not read or decrypt this PDF file.",
        };
      }

      if (!this.runner.exists(files.output)) {
        return {
          status: "unreadable",
          message: "qpdf did not produce decrypted output.",
        };
      }

      // Copy out of Emscripten FS so later cleanup does not alias the buffer.
      const decrypted = this.runner.readFile(files.output).slice();
      return { status: "ok", bytes: decrypted, wasEncrypted: true };
    } finally {
      removeScratchFiles(this.runner, files);
    }
  }

  /**
   * Runs Issue #20's lossless structural pass using qpdf:
   * `--object-streams=generate --recompress-flate --compression-level=9 --remove-unreferenced-resources=yes`.
   *
   * Generates compressed cross-reference streams and object streams (PDF 1.5+),
   * recompresses all Flate streams at level 9, and drops orphaned resources.
   *
   * @param bytes Unencrypted PDF bytes.
   * @returns Optimized bytes, or `null` if qpdf fails or does not shrink the file.
   */
  optimize(bytes: Uint8Array): { bytes: Uint8Array; warnings?: string } | null {
    const files = scratchFiles(`cmp-opt-${++this.jobSeq}`);
    this.runner.writeFile(files.input, bytes);

    try {
      const run = this.runner.run([
        "--object-streams=generate",
        "--recompress-flate",
        "--compression-level=9",
        "--remove-unreferenced-resources=yes",
        files.input,
        files.output,
      ]);

      if (run.code !== EXIT_OK && run.code !== EXIT_WARNINGS) {
        return null;
      }

      if (!this.runner.exists(files.output)) {
        return null;
      }

      const optimized = this.runner.readFile(files.output).slice();
      if (optimized.length === 0 || optimized.length >= bytes.length) {
        return null;
      }

      return {
        bytes: optimized,
        warnings:
          run.code === EXIT_WARNINGS && run.stderr.trim()
            ? run.stderr.trim()
            : undefined,
      };
    } finally {
      removeScratchFiles(this.runner, files);
    }
  }
}
