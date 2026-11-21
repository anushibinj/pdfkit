import type { InspectResult } from "../messages";

/** One input PDF, inside the worker. */
export interface PdfSource {
  bytes: Uint8Array;
  /** The user password of a password-protected file */
  password?: string;
}

/** What merging produced. Expected failures are values, not exceptions. */
export type MergeOutcome =
  | {
      status: "merged";
      bytes: Uint8Array;
      /** Present when the engine succeeded with warnings */
      warnings?: string;
    }
  | {
      status: "failed";
      message: string;
      /** Index into the sources of the file that failed, when known */
      sourceIndex?: number;
    };

/**
 * Anything that can check PDFs and merge them.
 *
 * The worker's request handler depends on this abstraction, not on qpdf, so
 * the engine can be replaced (or faked in tests) without touching it.
 */
export interface PdfMerger {
  /**
   * Open a file and count its pages.
   *
   * @param source The file and its password, if any.
   * @returns The page count, or why the file cannot be used.
   * @throws Only for unexpected failures (out of memory, an engine crash).
   */
  inspect(source: PdfSource): InspectResult;

  /**
   * Combine every page of every source, in the order given.
   *
   * @param sources At least one file.
   * @returns The merged PDF, or why merging failed.
   * @throws Only for unexpected failures (out of memory, an engine crash).
   */
  merge(sources: readonly PdfSource[]): MergeOutcome;
}
