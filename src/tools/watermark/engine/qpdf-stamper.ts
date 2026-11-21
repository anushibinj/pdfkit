import { EXIT_ERROR, friendlyQpdfMessage } from "@/lib/qpdf/qpdf-output";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import {
  newScratchToken,
  removeScratchFiles,
  scratchFiles,
  type ScratchFiles,
} from "@/lib/qpdf/scratch-files";
import type { Layer } from "../core/model";
import { formatPageRanges } from "../core/page-ranges";

/** Where the open PDF is kept in qpdf's memory file system. */
export const SOURCE_PATH = "/watermark-source.pdf";

/** A stamp PDF and how to lay it onto the PDF's pages. */
export interface StampJob {
  /** The stamp PDF (see `StampBuilder`). */
  stamp: Uint8Array;
  layer: Layer;
  /** 0-based PDF pages to stamp, ascending. */
  to: readonly number[];
  /** For each entry of `to`, the 0-based stamp page to use. */
  from: readonly number[];
}

/** qpdf refused to produce the output; the message is for the user. */
export class StampError extends Error {
  /** @param message What went wrong. */
  constructor(message: string) {
    super(message);
    this.name = "StampError";
  }
}

/**
 * The password option, if there is a password.
 *
 * @param password The user password, or "".
 * @returns `["--password=..."]` or nothing.
 */
export function passwordArgs(password: string): string[] {
  return password === "" ? [] : [`--password=${password}`];
}

/**
 * qpdf options that lay stamp pages onto PDF pages.
 *
 * `--overlay` draws the stamp after the page's content (on top),
 * `--underlay` before it (below). `--to` lists the PDF pages and `--from`
 * the stamp page for each of them, pairwise, in qpdf's 1-based page range
 * syntax. The lone "--" ends the overlay options.
 *
 * @param stampPath The stamp PDF in qpdf's file system.
 * @param job Layer and page mapping.
 * @returns The arguments.
 */
export function overlayArgs(
  stampPath: string,
  job: Pick<StampJob, "layer" | "to" | "from">,
): string[] {
  return [
    job.layer === "under" ? "--underlay" : "--overlay",
    stampPath,
    `--to=${formatPageRanges(job.to)}`,
    `--from=${formatPageRanges(job.from)}`,
    "--",
  ];
}

/**
 * Lays watermark stamps onto the open PDF with qpdf.
 *
 * qpdf adds each stamp page as a form XObject drawn by new content streams
 * placed before (underlay) or after (overlay) the page's own streams, which
 * it wraps in q/Q so state left over by the original content cannot shift
 * the watermark. The original content streams are not rewritten, and the
 * file keeps its encryption and password.
 */
export class QpdfStamper {
  /**
   * @param qpdf A ready qpdf instance.
   * @param newToken Makes the unique part of each job's file names
   *   (injected for tests).
   */
  constructor(
    private readonly qpdf: QpdfRunner,
    private readonly newToken: () => string = newScratchToken,
  ) {}

  /**
   * Keep the PDF in qpdf's file system for the following jobs, so a preview
   * does not copy the whole file in again.
   *
   * @param bytes The PDF.
   */
  load(bytes: Uint8Array): void {
    this.qpdf.writeFile(SOURCE_PATH, bytes);
  }

  /** Delete the kept PDF. Safe to call when nothing is loaded. */
  unload(): void {
    this.qpdf.remove(SOURCE_PATH);
  }

  /**
   * Produce the whole watermarked PDF.
   *
   * @param password The PDF's user password, or "".
   * @param job The stamp and page mapping.
   * @returns The new PDF's bytes.
   * @throws {StampError} When qpdf fails.
   */
  stampDocument(password: string, job: StampJob): Uint8Array {
    return this.withScratchFiles((files) => {
      this.qpdf.writeFile(files.input, job.stamp);
      return this.runToFile(
        [
          ...passwordArgs(password),
          SOURCE_PATH,
          ...overlayArgs(files.input, job),
          files.output,
        ],
        files.output,
      );
    });
  }

  /**
   * Produce a one-page PDF of a single page, stamped or not, for the
   * preview. `--pages . N --` keeps only page N of the primary input;
   * overlay options then refer to the output's pages, so the stamp goes on
   * page 1. Because the preview is the real qpdf output for that page, it
   * shows exactly what the download will contain.
   *
   * @param password The PDF's user password, or "".
   * @param pageIndex 0-based page to keep.
   * @param stamp A one-page stamp and its layer, or `null` for the page as
   *   it is.
   * @returns The one-page PDF (encrypted like the original).
   * @throws {StampError} When qpdf fails.
   */
  stampPreview(
    password: string,
    pageIndex: number,
    stamp: Pick<StampJob, "stamp" | "layer"> | null,
  ): Uint8Array {
    return this.withScratchFiles((files) => {
      const args = [
        ...passwordArgs(password),
        SOURCE_PATH,
        "--pages",
        ".",
        `${pageIndex + 1}`,
        "--",
      ];
      if (stamp) {
        this.qpdf.writeFile(files.input, stamp.stamp);
        args.push(
          ...overlayArgs(files.input, {
            layer: stamp.layer,
            to: [0],
            from: [0],
          }),
        );
      }
      return this.runToFile([...args, files.output], files.output);
    });
  }

  /**
   * Run `fn` with fresh file names for one job and delete those files
   * afterwards, whether it returns or throws (they live in WebAssembly
   * memory until deleted). A job's input is the stamp; the PDF itself stays
   * at {@link SOURCE_PATH} for the whole session.
   *
   * @param fn The job.
   * @returns What `fn` returns.
   */
  private withScratchFiles<T>(fn: (files: ScratchFiles) => T): T {
    const files = scratchFiles(this.newToken());
    try {
      return fn(files);
    } finally {
      removeScratchFiles(this.qpdf, files);
    }
  }

  /**
   * Run qpdf and read the file it wrote.
   *
   * Exit code 3 means qpdf succeeded with warnings (often a repaired
   * cross-reference table); the output is fine and is used.
   *
   * @param args The full command line.
   * @param output Where qpdf writes.
   * @returns The output's bytes. Emscripten's `FS.readFile` returns a copy
   *   (checked in the glue), so they stay valid after the file is deleted.
   * @throws {StampError} When qpdf failed or wrote nothing.
   */
  private runToFile(args: string[], output: string): Uint8Array {
    const run = this.qpdf.run(args);
    if (run.code === EXIT_ERROR || !this.qpdf.exists(output)) {
      throw new StampError(friendlyQpdfMessage(run.stderr));
    }
    return this.qpdf.readFile(output);
  }
}
