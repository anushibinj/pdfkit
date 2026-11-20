import {
  EXIT_OK,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "./qpdf-output";
import type { QpdfRunner } from "./qpdf-runner";

/** How a PDF is protected, as far as opening it is concerned. */
export type EncryptionStatus =
  /** Not encrypted at all. */
  | { kind: "not-encrypted" }
  /**
   * Encrypted, but it opens without a password: only an owner password and
   * restrictions (printing, copying, editing) are set.
   */
  | { kind: "opens-without-password" }
  /** A password is needed to open it. */
  | { kind: "password-required" }
  /** qpdf could not read the file (not a PDF, or damaged beyond repair). */
  | { kind: "unreadable"; message: string };

/**
 * Find out whether a PDF is encrypted and whether it needs a password.
 *
 * Uses `qpdf --requires-password <file>` without a password. Its documented
 * exit codes are 0 (a password is required), 2 (not encrypted) and 3
 * (encrypted, opened with the password given, here none). In practice qpdf
 * 11.0.0 reports a missing password as exit 2 with "invalid password" on
 * stderr, not as exit 0, and exit 2 is also its generic error code. So the
 * result is decided in this order:
 * 1. exit 3: it opened with no password, so only restrictions are set;
 * 2. exit 0, or "invalid password" on stderr: a password is required;
 * 3. any other exit with an empty stderr: not encrypted (the documented,
 *    silent exit 2);
 * 4. anything else: a real error, such as a file that is not a PDF.
 *
 * @param runner A loaded qpdf.
 * @param path The PDF, already written to qpdf's file system.
 * @returns The file's encryption status.
 */
export function probeEncryption(
  runner: QpdfRunner,
  path: string,
): EncryptionStatus {
  const probe = runner.run(["--requires-password", path]);
  if (probe.code === EXIT_WARNINGS) return { kind: "opens-without-password" };
  if (probe.code === EXIT_OK || isInvalidPassword(probe.stderr)) {
    return { kind: "password-required" };
  }
  if (probe.stderr.trim() === "") return { kind: "not-encrypted" };
  return { kind: "unreadable", message: friendlyQpdfMessage(probe.stderr) };
}
