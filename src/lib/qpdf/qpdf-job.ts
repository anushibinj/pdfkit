import type { QpdfRun, QpdfRunner } from "./qpdf-runner";

/**
 * qpdf's encryption settings for one job (`"encrypt"` in the job JSON).
 * Field names are qpdf's own; see `qpdf --job-json-help`.
 */
export interface QpdfEncryptSettings {
  /** Needed to open the file. */
  userPassword: string;
  /** Grants full access, including changing the security settings. */
  ownerPassword: string;
  /**
   * AES-256 encryption (PDF 2.0, revision 6) with per-permission options such
   * as `print` or `extract`, all as strings. An empty object allows
   * everything.
   */
  "256bit": Record<string, string>;
}

/**
 * One entry of a page selection (`--pages file [--password=...] range`), as
 * qpdf's job JSON spells it.
 */
export interface QpdfPageSelection {
  /** A PDF in qpdf's in-memory file system. */
  file: string;
  /** The password that opens `file`, if it needs one. */
  password?: string;
  /** qpdf page range syntax, e.g. "1-z" (all pages) or "1,3,5-7". */
  range: string;
}

/**
 * Where a job starts from: an input file, or (`empty`, like `--empty`) a
 * document without pages, which a page selection then fills. Exactly one of
 * the two; the `never` members make the compiler reject a job with both or
 * neither.
 */
export type QpdfJobInput =
  { inputFile: string; empty?: never } | { empty: ""; inputFile?: never };

/**
 * The subset of qpdf's job JSON (`qpdf --job-json-help`) that this app uses.
 * Flags that take no value on the command line, such as
 * `--requires-password`, are written as an empty string.
 */
export type QpdfJob = QpdfJobInput & QpdfJobOptions;

/** Everything in a {@link QpdfJob} except where it starts from. */
export interface QpdfJobOptions {
  outputFile?: string;
  /** Password used to open `inputFile`. */
  password?: string;
  /**
   * Like `--suppress-password-recovery`: try `password` exactly as given,
   * without retrying it in other encodings when it fails.
   */
  suppressPasswordRecovery?: "";
  /** Like `--requires-password`: only report the password status. */
  requiresPassword?: "";
  /** Like `--encrypt ... --`. */
  encrypt?: QpdfEncryptSettings;
  /**
   * Like `--pages ... --`: the output's pages, taken from these files in
   * this order. Each file's password travels in JSON like every other
   * password here (see {@link runQpdfJob}).
   */
  pages?: QpdfPageSelection[];
  /** Like `--show-npages`: print the page count on stdout. */
  showNpages?: "";
}

/**
 * Run qpdf with a job description in JSON instead of command line arguments.
 *
 * Why not the command line: qpdf treats any argument that starts with "@" as
 * the name of a file to read more arguments from, and the positional
 * arguments of `--encrypt` cannot hold a password such as "--" or
 * "--print=none" (both were verified to make qpdf 11.0.0 fail). A user's
 * password may legitimately look like any of those. In JSON, a password is
 * just a quoted string, so every value reaches qpdf exactly as typed.
 *
 * The JSON file holds passwords in clear text, so it is deleted in `finally`,
 * whether qpdf succeeded, failed or threw.
 *
 * @param runner A loaded qpdf.
 * @param jobPath Where to write the JSON in qpdf's in-memory file system.
 * @param job What qpdf should do.
 * @returns qpdf's exit code and stderr.
 */
export function runQpdfJob(
  runner: QpdfRunner,
  jobPath: string,
  job: QpdfJob,
): QpdfRun {
  runner.writeFile(jobPath, new TextEncoder().encode(JSON.stringify(job)));
  try {
    return runner.run([`--job-json-file=${jobPath}`]);
  } finally {
    runner.remove(jobPath);
  }
}
