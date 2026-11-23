/**
 * Pure domain types for comparing two PDF documents (text and visual).
 *
 * All structures here are plain JSON-serialisable values so they can cross the
 * Web Worker boundary without marshalling overhead, keeping the core domain
 * independent of React, DOM, and PDFium handles (Dependency Inversion).
 */
import type { PageBox, PageInfo } from "@/lib/pdfium/page-box";

/** Identifies which of the two uploaded PDFs a value belongs to. */
export type DocSide = "left" | "right";

/** Active comparison inspection mode in the UI. */
export type CompareMode = "text" | "visual";

/**
 * Axis-aligned rectangle in normalised display coordinates (`[0..1]`), with
 * origin at the top-left of the rendered page image and `y` increasing down.
 */
export interface NormalizedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Single character extracted from a PDF text page alongside its PDFium
 * generation flag and user-space glyph bounds.
 */
export interface CharWithBox {
  /** Unicode string representation of the character. */
  char: string;
  /** True when PDFium synthesised the character (e.g. gap-inferred space/newline). */
  generated: boolean;
  /** Tight glyph bounding box in PDF user space, or `null` for generated/whitespace glyphs. */
  box: PageBox | null;
}

/**
 * A contiguous word or punctuation token extracted from a page, paired with
 * the user-space bounding boxes of its constituent real glyphs.
 */
export interface WordToken {
  /** Exact surface text of the token as it appeared in the PDF. */
  text: string;
  /** Normalised text used for diffing and similarity scoring. */
  normalizedText: string;
  /** Per-character bounding boxes in PDF user space (non-empty for real text). */
  boxes: PageBox[];
}

/**
 * Full extracted text snapshot for a single PDF page.
 */
export interface ExtractedPageText {
  /** Zero-based page index within its source document. */
  pageIndex: number;
  /** Plain reading-order text of the page. */
  text: string;
  /** Ordered word and punctuation tokens with user-space glyph boxes. */
  tokens: WordToken[];
  /** False when the page has no extractable text tokens (e.g. scanned image). */
  hasText: boolean;
  /** Page dimensions and `/Rotate` flag needed for user-to-view transforms. */
  info: PageInfo;
}

/** Classification of a single word-level change hunk. */
export type TextChangeKind = "added" | "removed" | "modified";

/**
 * One coherent change hunk (an insertion, deletion, or paired replacement) on
 * an aligned page pair, carrying both PDF user-space boxes (for PDF report
 * annotations) and normalised view-space rects (for UI overlays).
 */
export interface TextChange {
  /** Stable identifier unique across the comparison (e.g. `"p0-c3"`). */
  id: string;
  /** Index into {@link CompareSummary.pairs}. */
  pairIndex: number;
  /** Whether text was added, removed, or modified in place. */
  kind: TextChangeKind;
  /** Removed text on the left (original) page, or `""` for pure insertions. */
  leftText: string;
  /** Inserted text on the right (revised) page, or `""` for pure deletions. */
  rightText: string;
  /** Line-merged boxes in the left page's PDF user space. */
  leftUserRects: PageBox[];
  /** Line-merged boxes in the right page's PDF user space. */
  rightUserRects: PageBox[];
  /** Normalised view-space highlight rectangles on the left page (`[0..1]`). */
  leftViewRects: NormalizedRect[];
  /** Normalised view-space highlight rectangles on the right page (`[0..1]`). */
  rightViewRects: NormalizedRect[];
  /** Vertical normalised anchor (`[0..1]`) used to scroll the active change into view. */
  anchorY: number;
}

/** Alignment outcome for one pair slot between left and right documents. */
export type PageAlignmentStatus = "matched" | "added" | "removed";

/**
 * One aligned entry produced by page alignment: either two paired pages, an
 * inserted right page, or a deleted left page.
 */
export interface AlignedPagePair {
  /** Zero-based index of this slot in the aligned sequence. */
  pairIndex: number;
  /** Zero-based page index in the left PDF, or `null` if the page was added. */
  leftIndex: number | null;
  /** Zero-based page index in the right PDF, or `null` if the page was removed. */
  rightIndex: number | null;
  /** Whether the pages were paired, added on the right, or removed from the left. */
  status: PageAlignmentStatus;
  /** Similarity score in `[0, 1]` between the paired pages (`0` for unmatched gaps). */
  similarity: number;
  /** Ordered word-level text changes found on this pair. */
  changes: TextChange[];
  /** Whether the left page (if present) contains extractable text. */
  leftHasText: boolean;
  /** Whether the right page (if present) contains extractable text. */
  rightHasText: boolean;
  /** Page geometry of the left page, if present. */
  leftInfo: PageInfo | null;
  /** Page geometry of the right page, if present. */
  rightInfo: PageInfo | null;
}

/**
 * Coarse bounding box of a contiguous cluster of visual pixel differences,
 * expressed in normalised `[0..1]` overlay coordinates.
 */
export interface VisualDiffRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Number of differing pixels inside this region's grid cells. */
  pixelCount: number;
}

/**
 * Summary statistics and bounding regions for a per-pixel visual comparison of
 * one aligned page pair.
 */
export interface VisualDiffSummary {
  pairIndex: number;
  /** Common aligned bitmap width in pixels (`max(leftWidth, rightWidth)`). */
  width: number;
  /** Common aligned bitmap height in pixels (`max(leftHeight, rightHeight)`). */
  height: number;
  leftWidth: number;
  leftHeight: number;
  rightWidth: number;
  rightHeight: number;
  /** True when the left and right pages had different pixel dimensions at the same DPI. */
  sizeMismatch: boolean;
  changedPixels: number;
  totalPixels: number;
  /** Percentage of differing pixels (`0..100`). */
  percentChanged: number;
  /** Clustered regions where visual pixels differ. */
  regions: VisualDiffRegion[];
}

/**
 * Top-level summary returned after opening and aligning two PDF documents.
 */
export interface CompareSummary {
  leftFileName: string;
  rightFileName: string;
  leftPageCount: number;
  rightPageCount: number;
  pairs: AlignedPagePair[];
  /** Total number of navigable text change hunks across all pairs. */
  totalChanges: number;
  /** Total added word count across all pairs. */
  addedWords: number;
  /** Total removed word count across all pairs. */
  removedWords: number;
  /** Number of pages across both PDFs that have no extractable text layer. */
  scannedPagesCount: number;
}
