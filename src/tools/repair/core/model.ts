/**
 * Core domain types and data contracts for the PDF Repair tool.
 *
 * Follows Single Responsibility Principle (SRP) by keeping pure data interfaces
 * decoupled from worker execution and UI rendering logic.
 */

/** Detailed report of structural recoveries and modifications made to a damaged PDF. */
export interface RepairReport {
  /** True when a missing or corrupt %PDF- header was fixed or leading junk was stripped. */
  headerRepaired: boolean;
  /** True when missing or corrupt %%EOF was fixed or trailing garbage was stripped. */
  eofRepaired: boolean;
  /** True when the cross-reference table was reconstructed from linear object scanning. */
  xrefReconstructed: boolean;
  /** True when the trailer dictionary was reconstructed or synthesized. */
  trailerReconstructed: boolean;
  /** Number of indirect PDF objects salvaged. */
  objectsRecovered: number;
  /** Number of stream objects whose length or delimiters were corrected. */
  streamsRepaired: number;
  /** Number of valid pages successfully salvaged and confirmed renderable. */
  pagesRecovered: number;
  /** Diagnostic list of specific repairs performed. */
  issues: string[];
}

/** The result of repairing one PDF document. */
export type RepairOutcome =
  | {
      kind: "repaired";
      /** The repaired, valid PDF bytes. */
      pdf: Uint8Array;
      /** Total number of readable pages in the repaired document. */
      pageCount: number;
      /** Detailed breakdown of what was repaired. */
      report: RepairReport;
      /** Non-fatal warnings produced during validation or normalization. */
      warnings?: string;
    }
  | {
      kind: "unmodified";
      /** The file is already completely valid and required no structural repair. */
      pageCount: number;
    }
  | {
      kind: "password-required";
    }
  | {
      kind: "failed";
      /** Human-readable explanation of why the document could not be salvaged. */
      message: string;
    };
