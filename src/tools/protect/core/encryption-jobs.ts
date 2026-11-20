import type { QpdfJob } from "@/lib/qpdf/qpdf-job";
import type { ScratchFiles } from "@/lib/qpdf/scratch-files";

/**
 * Build the qpdf job that encrypts a PDF so it needs `password` to open.
 *
 * Choices, and why:
 * - AES-256 (`"256bit"`, PDF 2.0 revision 6) only. qpdf calls 40-bit and
 *   128-bit RC4 insecure and refuses to write them without
 *   `--allow-weak-crypto`; every current reader opens AES-256.
 * - Owner password = user password. The owner password is what a PDF app
 *   asks for before it lets someone change or remove the security settings.
 *   Leaving it empty is not an option: with AES-256 an empty owner password
 *   would let anyone open the file without a password (qpdf refuses unless
 *   `--allow-insecure` is given). A random one would lock the user out of
 *   changing their own file's password later. Using the same password gives
 *   the person who knows it full control, which is what "protect with a
 *   password" means.
 * - No permission options (`"256bit": {}`), so everything is allowed once
 *   the file is open. Restrictions are a different feature.
 *
 * @param files The job's input and output paths.
 * @param password The password, already checked by the password policy.
 * @returns The job description for `runQpdfJob`.
 */
export function encryptJob(
  files: Pick<ScratchFiles, "input" | "output">,
  password: string,
): QpdfJob {
  return {
    inputFile: files.input,
    outputFile: files.output,
    encrypt: {
      userPassword: password,
      ownerPassword: password,
      "256bit": {},
    },
  };
}

/**
 * Build the qpdf job that checks whether `password` opens a PDF.
 *
 * qpdf exits with 3 when the file is encrypted and the password opens it.
 * `suppressPasswordRecovery` makes the check exact: by default, when a
 * non-ASCII password fails, qpdf retries it in several other encodings. That
 * would let the check pass for bytes that PDFium or pdf.js, which try only
 * the exact UTF-8 bytes, would refuse.
 *
 * @param path The PDF in qpdf's file system.
 * @param password The password to try.
 * @returns The job description for `runQpdfJob`.
 */
export function passwordCheckJob(path: string, password: string): QpdfJob {
  return {
    inputFile: path,
    password,
    suppressPasswordRecovery: "",
    requiresPassword: "",
  };
}
