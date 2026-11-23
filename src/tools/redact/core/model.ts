import type { PageBox } from "@/lib/pdfium/page-box";

/** Fill colour used to draw a permanent redaction box on the page. */
export type RedactionFill = "black" | "white";

/** Visual style applied when burning a redaction mark into a page. */
export interface RedactionMarkStyle {
  /** Solid background fill colour of the redaction rectangle. */
  fill: RedactionFill;
  /** Optional text label drawn centered inside the box (e.g. "REDACTED"). */
  label: string;
}

/** Built-in search preset identifiers for sensitive data discovery. */
export type PresetId =
  | "email"
  | "phone"
  | "pan"
  | "aadhaar"
  | "ifsc"
  | "card"
  | "date";

/** How a redaction mark was created. */
export type RedactionSource = "manual" | "text" | "regex" | PresetId;

/** One candidate or confirmed redaction region on a PDF page. */
export interface RedactionMark {
  /** Unique client-side identifier for review list selection and toggling. */
  id: string;
  /** Zero-based source page index. */
  pageIndex: number;
  /** Bounding rectangle in PDF user-space points (y pointing up). */
  box: PageBox;
  /** Matched or extracted text under the box (empty for pure graphic regions). */
  term: string;
  /** Origin of this mark (manual box, search, regex, or a named preset). */
  source: RedactionSource;
  /** Human-readable category label shown in the review list. */
  label: string;
  /** Whether the user kept this mark enabled for redaction (unticking skips false positives). */
  enabled: boolean;
}

/** Document-wide structural cleanup flags executed by `pdf-redact.wasm`. */
export interface CleanupOptions {
  /** Strip `/Info`, XMP `/Metadata` streams, `/PieceInfo`, `/Thumb`, and matching `/StructTreeRoot` text. */
  metadata: boolean;
  /** Strip `/EmbeddedFiles`, `/AF`, and `/FileAttachment` annotations. */
  attachments: boolean;
  /** Strip `/JavaScript` names, JS `/OpenAction`, and `/AA` actions. */
  javascript: boolean;
  /** Strip `/OCProperties` optional content groups (hidden layers). */
  hiddenLayers: boolean;
  /** Scrub `/Outlines` bookmark titles that contain any redacted term. */
  bookmarks: boolean;
}

/** Complete redaction plan sent from the UI to the worker. */
export interface RedactionPlan {
  /** All candidate marks (enabled marks are redacted; disabled marks track intentional false positives). */
  marks: RedactionMark[];
  /** Fill and overlay label style for the drawn redaction boxes. */
  style: RedactionMarkStyle;
  /** Document-wide structural sanitization toggles. */
  cleanup: CleanupOptions;
  /** Maximum-certainty fallback: rasterise redacted pages into flat PNG images. */
  rasterizePages: boolean;
}

/** Metrics returned by the `pdf-redact` WebAssembly sanitization engine. */
export interface SanitizeReportMetrics {
  metadataEntriesRemoved: number;
  xmpStreamsRemoved: number;
  attachmentsRemoved: number;
  javascriptActionsRemoved: number;
  hiddenLayersRemoved: number;
  bookmarksCleaned: number;
  annotationsRemoved: number;
  formValuesCleared: number;
  objectsPruned: number;
}

/** One leaked term detected during post-save verification. */
export interface LeakedTerm {
  pageIndex: number;
  term: string;
}

/** Result of reopening the saved output and verifying zero redacted terms remain. */
export interface VerificationReport {
  /** True only when zero redacted terms or covered glyphs remain anywhere in the output. */
  verified: boolean;
  /** Total number of enabled redaction terms/marks checked after saving. */
  totalTerms: number;
  /** Count of terms/marks that could still be extracted or found in the saved file. */
  remainingTerms: number;
  /** Specific leaked terms and pages when verification fails. */
  leakedTerms: LeakedTerm[];
  /** Human-readable verification summary (e.g. "0 of 14 redacted terms remain"). */
  summary: string;
}

/** Complete report produced after applying and verifying redactions. */
export interface RedactionReport {
  pagesRedacted: number;
  marksApplied: number;
  textObjectsRemoved: number;
  textObjectsSplit: number;
  imagesModified: number;
  pathsRemoved: number;
  annotationsRemoved: number;
  pagesRasterized: number;
  sanitize: SanitizeReportMetrics;
  verification: VerificationReport;
}

/** Default mark style: solid black box with "REDACTED" label. */
export const DEFAULT_MARK_STYLE: RedactionMarkStyle = {
  fill: "black",
  label: "REDACTED",
};

/** Default document-wide cleanup options: every sanitization pass enabled. */
export const DEFAULT_CLEANUP_OPTIONS: CleanupOptions = {
  metadata: true,
  attachments: true,
  javascript: true,
  hiddenLayers: true,
  bookmarks: true,
};
