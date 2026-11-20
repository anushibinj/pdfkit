import { findSignatures } from "@/lib/pdf-signature-scan";
import { probeEncryption } from "@/lib/qpdf/encryption-status";
import {
  EXIT_ERROR,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
} from "@/lib/qpdf/qpdf-output";
import { runQpdfJob } from "@/lib/qpdf/qpdf-job";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import {
  newScratchToken,
  removeScratchFiles,
  scratchFiles,
  type ScratchFiles,
} from "@/lib/qpdf/scratch-files";
import { encryptJob, passwordCheckJob } from "./encryption-jobs";
import {
  describePasswordProblem,
  findPasswordProblem,
} from "./password-policy";

/** The result of protecting one PDF. */
export type ProtectOutcome =
  | {
      kind: "protected";
      /** The encrypted PDF. */
      pdf: Uint8Array;
      /**
       * The input already had restrictions (printing, copying, editing) set
       * with an owner password but opened without a password. Encrypting
       * replaces those settings, so the new file has no restrictions.
       */
      replacedRestrictions: boolean;
      /**
       * How many digital signatures the input had. Encrypting rewrites every
       * byte the signatures cover, so none of them is valid in the new file
       * (the original file is not changed).
       */
      invalidatedSignatures: number;
      /** qpdf's warnings, for example after repairing a damaged file. */
      warnings?: string;
    }
  /** The input already needs a password to open; it is left alone. */
  | { kind: "already-protected" }
  /** Nothing was produced; `message` says why, for a person to read. */
  | { kind: "failed"; message: string };

/** Shown if the written file does not behave as a protected file must. */
export const VERIFICATION_FAILED_MESSAGE =
  "The protected file did not pass its final check, so it was not offered for download. Please try again.";

/**
 * Adds an open password to PDFs, using qpdf.
 *
 * Single responsibility: decide the steps of protecting one file. Running
 * qpdf is delegated to a {@link QpdfRunner} (injected, so the steps are
 * tested with a fake), the job contents to `encryption-jobs.ts` and the
 * password rules to `password-policy.ts`.
 */
export class PdfProtector {
  /**
   * @param qpdf A loaded qpdf.
   * @param newToken Makes a unique token for each job's file names (injected
   *   by tests to know the names).
   */
  constructor(
    private readonly qpdf: QpdfRunner,
    private readonly newToken: () => string = newScratchToken,
  ) {}

  /**
   * Encrypt one PDF so that it needs `password` to open.
   *
   * Steps:
   * 1. Check the password against the policy. The form already does this,
   *    but this request crossed a thread boundary, so it is checked again.
   *    A bad password fails before any file is written.
   * 2. Write the PDF to qpdf's in-memory file system and find out how it is
   *    protected now:
   *    - already needs a password: stop with "already-protected". qpdf
   *      would need that password to read it, and silently replacing
   *      someone's existing password is not this tool's job;
   *    - unreadable: stop with qpdf's explanation;
   *    - opens without a password but has restrictions: continue, and
   *      report that they were replaced;
   *    - not encrypted: continue.
   * 3. Encrypt with AES-256 through a job JSON file (see `runQpdfJob` for
   *    why not command line arguments). Exit code 3 means it worked, with
   *    warnings worth showing (for example, the input needed repairs).
   * 4. Verify the result before handing it over (see {@link verify}).
   *    A file that would lock its owner out must never be offered.
   * 5. Count the input's digital signatures (a byte scan of the input, see
   *    `findSignatures`). A signature covers exact file bytes and encrypting
   *    rewrites them all, so every signature is invalid in the new file.
   *    Testing confirmed it: the Verifier calls the fixture's signature
   *    valid before and unreadable after. The count lets the page say so.
   * 6. Always delete the input, output and job files, whatever happened,
   *    so no copy of the document or the password stays in memory longer
   *    than needed.
   *
   * @param pdf The PDF's bytes.
   * @param password The password that will open the file.
   * @returns What happened.
   * @throws Only when qpdf itself crashes (for example out of memory); the
   *   caller should then discard this qpdf instance.
   */
  protect(pdf: Uint8Array, password: string): ProtectOutcome {
    const problem = findPasswordProblem(password);
    if (problem) {
      return { kind: "failed", message: describePasswordProblem(problem) };
    }

    const files = scratchFiles(this.newToken());
    try {
      this.qpdf.writeFile(files.input, pdf);
      const before = probeEncryption(this.qpdf, files.input);
      if (before.kind === "password-required") {
        return { kind: "already-protected" };
      }
      if (before.kind === "unreadable") {
        return { kind: "failed", message: before.message };
      }

      const run = runQpdfJob(this.qpdf, files.job, encryptJob(files, password));
      if (run.code === EXIT_ERROR || !this.qpdf.exists(files.output)) {
        return { kind: "failed", message: friendlyQpdfMessage(run.stderr) };
      }
      if (!this.verify(files, password)) {
        return { kind: "failed", message: VERIFICATION_FAILED_MESSAGE };
      }

      return {
        kind: "protected",
        pdf: this.qpdf.readFile(files.output),
        replacedRestrictions: before.kind === "opens-without-password",
        invalidatedSignatures: findSignatures(pdf).found.length,
        warnings:
          run.code === EXIT_WARNINGS
            ? friendlyQpdfMessage(run.stderr)
            : undefined,
      };
    } finally {
      removeScratchFiles(this.qpdf, files);
    }
  }

  /**
   * Check the written file the way a reader will see it:
   * 1. without a password it must be refused ("password-required"). This
   *    guards against any path that would produce a file that opens freely,
   *    such as an empty owner password with AES-256;
   * 2. with exactly the password the user typed it must open (qpdf exit 3,
   *    with qpdf's retries in other encodings switched off, see
   *    `passwordCheckJob`). This guards against the password reaching qpdf
   *    in a different form than the user will type it.
   *
   * @param files The job's files; `output` is checked, `job` is reused.
   * @param password The password the user chose.
   * @returns `true` when both checks pass.
   */
  private verify(files: ScratchFiles, password: string): boolean {
    if (probeEncryption(this.qpdf, files.output).kind !== "password-required") {
      return false;
    }
    const check = runQpdfJob(
      this.qpdf,
      files.job,
      passwordCheckJob(files.output, password),
    );
    return check.code === EXIT_WARNINGS;
  }
}
