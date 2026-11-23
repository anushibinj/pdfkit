/**
 * Builds an annotated Comparison Report PDF using PDFium WebAssembly.
 */
import { applyToPoint } from "@/lib/affine";
import { check, insertNewObject } from "@/lib/pdfium/page-objects";
import { viewSize, viewToUser, type PageBox } from "@/lib/pdfium/page-box";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import {
  boundsOfUserBoxes,
  userBoxToQuadPoints,
} from "../core/box-geometry";
import type {
  AlignedPagePair,
  CompareSummary,
  VisualDiffRegion,
  VisualDiffSummary,
} from "../core/model";
import {
  FPDF_ANNOT_COLOR_MAIN,
  FPDF_ANNOT_FLAG_PRINT,
  FPDF_ANNOT_HIGHLIGHT,
  FPDF_ANNOT_SQUARE,
  type ComparePdfiumApi,
} from "./pdfium-api";

const SUMMARY_PAGE_WIDTH = 612;
const SUMMARY_PAGE_HEIGHT = 792;
const SUMMARY_MARGIN_X = 48;
const SUMMARY_START_Y = 740;
const SUMMARY_MIN_Y = 56;
const MAX_ANNOT_NOTE_CHARS = 320;

/** Inputs required to generate the comparison report PDF. */
export interface ReportBuildInput {
  summary: CompareSummary;
  leftDoc: PdfiumDocument;
  rightDoc: PdfiumDocument;
  visualDiffs: ReadonlyMap<number, VisualDiffSummary>;
}

/**
 * Abstraction for assembling the downloadable comparison report PDF
 * (Dependency Inversion Principle).
 */
export interface ComparisonReportBuilder {
  /**
   * Build the comparison report PDF and return its serialised bytes.
   *
   * @param input Comparison summary, open source documents, and visual diffs.
   * @returns Serialised PDF file bytes.
   */
  buildReport(input: ReportBuildInput): Uint8Array;
}

interface HighlightSpec {
  boxes: readonly PageBox[];
  color: { r: number; g: number; b: number; a: number };
  author: string;
  contents: string;
}

interface SummaryLine {
  text: string;
  font: "Helvetica" | "Helvetica-Bold";
  fontSize: number;
  leading: number;
  color: { r: number; g: number; b: number };
}

/**
 * Sanitise a string to WinAnsi-safe ASCII characters so PDFium's standard
 * Helvetica font renders every character on the summary page reliably.
 *
 * @param raw Arbitrary Unicode string.
 * @returns WinAnsi-safe single-line string.
 */
export function toSummaryAscii(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e]/g, "?")
    .trim();
}

/**
 * Truncate a string cleanly to `maxChars` with an ellipsis if needed.
 *
 * @param value Input text.
 * @param maxChars Maximum length.
 * @returns Truncated string.
 */
export function truncateNote(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

/**
 * Build the sequence of text lines for the comparison summary cover page(s).
 *
 * @param summary Overall comparison summary.
 * @param visualDiffs Visual diff metrics computed for pairs (if any).
 * @returns Ordered list of styled lines to lay out across cover pages.
 */
export function buildSummaryLines(
  summary: CompareSummary,
  visualDiffs: ReadonlyMap<number, VisualDiffSummary>,
): SummaryLine[] {
  const dark = { r: 24, g: 24, b: 27 };
  const muted = { r: 82, g: 82, b: 91 };
  const lines: SummaryLine[] = [
    {
      text: "PDF Comparison Report",
      font: "Helvetica-Bold",
      fontSize: 20,
      leading: 30,
      color: dark,
    },
    {
      text: `Original (Left): ${toSummaryAscii(summary.leftFileName)} (${summary.leftPageCount} pages)`,
      font: "Helvetica",
      fontSize: 11,
      leading: 16,
      color: dark,
    },
    {
      text: `Revised (Right): ${toSummaryAscii(summary.rightFileName)} (${summary.rightPageCount} pages)`,
      font: "Helvetica",
      fontSize: 11,
      leading: 22,
      color: dark,
    },
    {
      text: `Summary: ${summary.totalChanges} text change(s), +${summary.addedWords} added words, -${summary.removedWords} removed words`,
      font: "Helvetica-Bold",
      fontSize: 11,
      leading: 18,
      color: dark,
    },
    {
      text: "Legend: Green highlights = Inserted text (Revised) | Red highlights = Deleted text (Original) | Amber boxes = Visual diffs",
      font: "Helvetica",
      fontSize: 9.5,
      leading: 22,
      color: muted,
    },
    {
      text: "Page Alignment & Changes",
      font: "Helvetica-Bold",
      fontSize: 13,
      leading: 20,
      color: dark,
    },
  ];

  if (summary.scannedPagesCount > 0) {
    lines.splice(4, 0, {
      text: `Note: ${summary.scannedPagesCount} page(s) have no extractable text layer (scanned/image-only).`,
      font: "Helvetica",
      fontSize: 10,
      leading: 16,
      color: muted,
    });
  }

  for (const pair of summary.pairs) {
    const visual = visualDiffs.get(pair.pairIndex);
    const visualSuffix =
      visual && visual.changedPixels > 0
        ? ` | Visual: ${visual.percentChanged}% changed`
        : "";
    let desc: string;
    if (pair.status === "added") {
      desc = `Right p.${pair.rightIndex! + 1}: Page inserted (${pair.changes.length} change block)`;
    } else if (pair.status === "removed") {
      desc = `Left p.${pair.leftIndex! + 1}: Page removed (${pair.changes.length} change block)`;
    } else {
      desc = `Left p.${pair.leftIndex! + 1} <-> Right p.${pair.rightIndex! + 1}: ${pair.changes.length} text change(s)${visualSuffix}`;
    }
    lines.push({
      text: desc,
      font: "Helvetica",
      fontSize: 10,
      leading: 15,
      color: dark,
    });
  }

  return lines;
}

/** PDFium-backed implementation of {@link ComparisonReportBuilder}. */
export class PdfiumComparisonReportBuilder implements ComparisonReportBuilder {
  /**
   * @param api Segregated PDFium WASM API.
   * @param heap Memory helper bound to `api.pdfium`.
   */
  constructor(
    private readonly api: ComparePdfiumApi,
    private readonly heap: WasmHeap,
  ) {}

  /**
   * Assemble a complete comparison report PDF containing summary page(s)
   * followed by annotated original/revised pages.
   *
   * @param input Comparison summary, open PDFium documents, and visual diffs.
   * @returns Serialised PDF bytes ready for download.
   */
  buildReport(input: ReportBuildInput): Uint8Array {
    const outDoc = PdfiumDocument.create(this.api, this.heap);
    try {
      this.writeSummaryPages(outDoc, input.summary, input.visualDiffs);

      for (const pair of input.summary.pairs) {
        this.appendPairPages(
          outDoc,
          pair,
          input.leftDoc,
          input.rightDoc,
          input.visualDiffs.get(pair.pairIndex),
        );
      }

      return outDoc.save();
    } finally {
      outDoc.close();
    }
  }

  /**
   * Write one or more Letter-sized cover summary pages at the front of `outDoc`.
   *
   * @param outDoc Destination report document.
   * @param summary Comparison summary.
   * @param visualDiffs Map of computed visual diff summaries by pair index.
   */
  private writeSummaryPages(
    outDoc: PdfiumDocument,
    summary: CompareSummary,
    visualDiffs: ReadonlyMap<number, VisualDiffSummary>,
  ): void {
    const lines = buildSummaryLines(summary, visualDiffs);
    let pageIdx = outDoc.pageCount();
    let cursor = 0;

    while (cursor < lines.length) {
      outDoc.withNewPage(
        pageIdx++,
        SUMMARY_PAGE_WIDTH,
        SUMMARY_PAGE_HEIGHT,
        (page) => {
          let y = SUMMARY_START_Y;
          while (cursor < lines.length && y >= SUMMARY_MIN_Y) {
            const line = lines[cursor++];
            this.drawSummaryLine(outDoc.handle, page, line, SUMMARY_MARGIN_X, y);
            y -= line.leading;
          }
          check(
            this.api.FPDFPage_GenerateContent(page),
            "write comparison summary page",
          );
        },
      );
    }
  }

  /**
   * Draw one standard-font text line on a cover summary page.
   *
   * @param docHandle Handle of the destination `FPDF_DOCUMENT`.
   * @param page Handle of the loaded `FPDF_PAGE`.
   * @param line Line content and styling.
   * @param x Left coordinate in points.
   * @param y Baseline coordinate in points.
   */
  private drawSummaryLine(
    docHandle: number,
    page: number,
    line: SummaryLine,
    x: number,
    y: number,
  ): void {
    insertNewObject(
      { api: this.api, page },
      () =>
        this.api.FPDFPageObj_NewTextObj(docHandle, line.font, line.fontSize),
      (obj) => {
        this.heap.using(this.heap.utf16(line.text), (textPtr) =>
          check(this.api.FPDFText_SetText(obj, textPtr), "set summary text"),
        );
        check(
          this.api.FPDFPageObj_SetFillColor(
            obj,
            line.color.r,
            line.color.g,
            line.color.b,
            255,
          ),
          "colour summary text",
        );
      },
      [1, 0, 0, 1, x, y],
      "a summary text line",
    );
  }

  /**
   * Import and annotate the document page(s) for one aligned pair.
   *
   * @param outDoc Destination report document.
   * @param pair Aligned page pair metadata and text changes.
   * @param leftDoc Open original document.
   * @param rightDoc Open revised document.
   * @param visual Optional visual diff summary computed for this pair.
   */
  private appendPairPages(
    outDoc: PdfiumDocument,
    pair: AlignedPagePair,
    leftDoc: PdfiumDocument,
    rightDoc: PdfiumDocument,
    visual: VisualDiffSummary | undefined,
  ): void {
    const deletionChanges = pair.changes.filter(
      (c) => c.leftUserRects.length > 0,
    );
    const insertionChanges = pair.changes.filter(
      (c) => c.rightUserRects.length > 0,
    );

    if (pair.status === "removed" && pair.leftIndex !== null) {
      const idx = this.importSinglePage(outDoc, leftDoc, pair.leftIndex);
      outDoc.withPage(idx, (page) => {
        for (const change of deletionChanges) {
          this.addHighlightAnnot(page, {
            boxes: change.leftUserRects,
            color: { r: 239, g: 68, b: 68, a: 100 },
            author: "Removed Page",
            contents: `Removed: ${truncateNote(change.leftText, MAX_ANNOT_NOTE_CHARS)}`,
          });
        }
      });
      return;
    }

    if (pair.status === "added" && pair.rightIndex !== null) {
      const idx = this.importSinglePage(outDoc, rightDoc, pair.rightIndex);
      outDoc.withPage(idx, (page) => {
        for (const change of insertionChanges) {
          this.addHighlightAnnot(page, {
            boxes: change.rightUserRects,
            color: { r: 34, g: 197, b: 94, a: 100 },
            author: "Added Page",
            contents: `Added: ${truncateNote(change.rightText, MAX_ANNOT_NOTE_CHARS)}`,
          });
        }
      });
      return;
    }

    if (deletionChanges.length > 0 && pair.leftIndex !== null) {
      const leftOutIdx = this.importSinglePage(outDoc, leftDoc, pair.leftIndex);
      outDoc.withPage(leftOutIdx, (page) => {
        for (const change of deletionChanges) {
          const note =
            change.kind === "modified"
              ? `Replaced "${truncateNote(change.leftText, 120)}" with "${truncateNote(change.rightText, 120)}"`
              : `Deleted: "${truncateNote(change.leftText, MAX_ANNOT_NOTE_CHARS)}"`;
          this.addHighlightAnnot(page, {
            boxes: change.leftUserRects,
            color: { r: 239, g: 68, b: 68, a: 100 },
            author: "Original (Deleted)",
            contents: note,
          });
        }
      });
    }

    if (pair.rightIndex !== null) {
      const rightOutIdx = this.importSinglePage(
        outDoc,
        rightDoc,
        pair.rightIndex,
      );
      outDoc.withPage(rightOutIdx, (page) => {
        for (const change of insertionChanges) {
          const note =
            change.kind === "modified"
              ? `Changed from "${truncateNote(change.leftText, 120)}" to "${truncateNote(change.rightText, 120)}"`
              : `Inserted: "${truncateNote(change.rightText, MAX_ANNOT_NOTE_CHARS)}"`;
          this.addHighlightAnnot(page, {
            boxes: change.rightUserRects,
            color: { r: 34, g: 197, b: 94, a: 100 },
            author: "Revised (Inserted)",
            contents: note,
          });
        }

        if (visual && visual.regions.length > 0 && pair.rightInfo) {
          for (const region of visual.regions) {
            this.addVisualRegionSquare(page, pair, region);
          }
        }
      });
    }
  }

  /**
   * Import one page from `srcDoc` at the end of `destDoc`.
   *
   * @param destDoc Target document.
   * @param srcDoc Source document.
   * @param srcPageIndex Zero-based page index in `srcDoc`.
   * @returns Zero-based index of the newly imported page in `destDoc`.
   */
  private importSinglePage(
    destDoc: PdfiumDocument,
    srcDoc: PdfiumDocument,
    srcPageIndex: number,
  ): number {
    const destIndex = destDoc.pageCount();
    this.heap.using(this.heap.ints([srcPageIndex]), (indicesPtr) => {
      check(
        this.api.FPDF_ImportPagesByIndex(
          destDoc.handle,
          srcDoc.handle,
          indicesPtr,
          1,
          destIndex,
        ),
        `import page ${srcPageIndex + 1}`,
      );
    });
    return destIndex;
  }

  /**
   * Create a PDF Highlight annotation covering `spec.boxes` with QuadPoints,
   * bounding Rect, RGBA colour, popup metadata, and generated `/AP` stream.
   *
   * @param page Loaded `FPDF_PAGE` handle.
   * @param spec Highlight boxes, colour, author, and popup note.
   */
  private addHighlightAnnot(page: number, spec: HighlightSpec): void {
    const bounds = boundsOfUserBoxes(spec.boxes);
    if (!bounds) return;

    const annot = this.api.FPDFPage_CreateAnnot(page, FPDF_ANNOT_HIGHLIGHT);
    if (!annot) return;

    try {
      for (const box of spec.boxes) {
        const quad = userBoxToQuadPoints(box);
        this.heap.using(this.heap.floats(quad), (quadPtr) => {
          this.api.FPDFAnnot_AppendAttachmentPoints(annot, quadPtr);
        });
      }

      this.heap.using(
        this.heap.floats([bounds.left, bounds.top, bounds.right, bounds.bottom]),
        (rectPtr) => {
          this.api.FPDFAnnot_SetRect(annot, rectPtr);
        },
      );

      this.api.FPDFAnnot_SetColor(
        annot,
        FPDF_ANNOT_COLOR_MAIN,
        spec.color.r,
        spec.color.g,
        spec.color.b,
        spec.color.a,
      );
      this.api.FPDFAnnot_SetFlags(annot, FPDF_ANNOT_FLAG_PRINT);

      this.heap.using(this.heap.utf16(spec.author), (ptr) => {
        this.api.FPDFAnnot_SetStringValue(annot, "T", ptr);
      });
      this.heap.using(this.heap.utf16(spec.contents), (ptr) => {
        this.api.FPDFAnnot_SetStringValue(annot, "Contents", ptr);
      });

      this.api.EPDFAnnot_GenerateAppearance(annot);
    } finally {
      this.api.FPDFPage_CloseAnnot(annot);
    }
  }

  /**
   * Add an amber Square annotation on the revised page around a visual-diff
   * region, mapping normalised view-space coordinates back to PDF user space.
   *
   * @param page Loaded `FPDF_PAGE` handle.
   * @param pair Aligned pair providing `rightInfo` geometry.
   * @param region Normalised `[0..1]` visual diff region.
   */
  private addVisualRegionSquare(
    page: number,
    pair: AlignedPagePair,
    region: VisualDiffRegion,
  ): void {
    const info = pair.rightInfo;
    if (!info) return;

    const view = viewSize(info.box, info.rotation);
    const toUser = viewToUser(info.box, info.rotation);
    const p1 = applyToPoint(toUser, {
      x: region.left * view.width,
      y: region.top * view.height,
    });
    const p2 = applyToPoint(toUser, {
      x: region.right * view.width,
      y: region.bottom * view.height,
    });

    const left = Math.min(p1.x, p2.x);
    const right = Math.max(p1.x, p2.x);
    const bottom = Math.min(p1.y, p2.y);
    const top = Math.max(p1.y, p2.y);
    if (right <= left || top <= bottom) return;

    const annot = this.api.FPDFPage_CreateAnnot(page, FPDF_ANNOT_SQUARE);
    if (!annot) return;
    try {
      this.heap.using(
        this.heap.floats([left, top, right, bottom]),
        (rectPtr) => {
          this.api.FPDFAnnot_SetRect(annot, rectPtr);
        },
      );
      this.api.FPDFAnnot_SetColor(annot, FPDF_ANNOT_COLOR_MAIN, 217, 119, 6, 220);
      this.api.FPDFAnnot_SetBorder(annot, 0, 0, 1.5);
      this.api.FPDFAnnot_SetFlags(annot, FPDF_ANNOT_FLAG_PRINT);
      this.heap.using(this.heap.utf16("Visual Difference"), (ptr) => {
        this.api.FPDFAnnot_SetStringValue(annot, "T", ptr);
      });
      this.heap.using(
        this.heap.utf16(
          `Visual difference detected (${region.pixelCount} changed pixels).`,
        ),
        (ptr) => {
          this.api.FPDFAnnot_SetStringValue(annot, "Contents", ptr);
        },
      );
      this.api.EPDFAnnot_GenerateAppearance(annot);
    } finally {
      this.api.FPDFPage_CloseAnnot(annot);
    }
  }
}
