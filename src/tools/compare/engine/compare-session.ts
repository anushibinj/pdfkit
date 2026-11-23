/**
 * Worker-side PDF comparison session owning both opened {@link PdfiumDocument}s,
 * extracted per-page text snapshots, page alignment, visual pixel differ, and
 * comparison report export.
 */
import { boxSize, viewSize, type PageInfo } from "@/lib/pdfium/page-box";
import {
  PdfiumDocument,
  type RenderedPage,
} from "@/lib/pdfium/pdfium-document";
import { fitRenderSize } from "@/lib/pdfium/render-size";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type {
  AlignedPagePair,
  CompareSummary,
  DocSide,
  ExtractedPageText,
  VisualDiffSummary,
} from "../core/model";
import { alignPages, type PageSignature } from "../core/page-alignment";
import { diffPageText } from "../core/text-diff";
import { CpuPixelDiffer, type PixelDiffer } from "../core/visual-diff";
import {
  PdfiumPageTextExtractor,
  type PdfTextExtractor,
} from "./page-text-extractor";
import type { ComparePdfiumApi } from "./pdfium-api";
import {
  PdfiumComparisonReportBuilder,
  type ComparisonReportBuilder,
} from "./report-builder";

interface SideState {
  fileName: string;
  doc: PdfiumDocument;
  pages: ExtractedPageText[];
}

/** Result of opening one side's PDF. */
export interface OpenSideOutcome {
  side: DocSide;
  pageCount: number;
  scannedPages: number;
  summary: CompareSummary | null;
}

/** Result of rendering and pixel-diffing one aligned page pair. */
export interface ComputedVisualDiff {
  pixels: Uint8Array;
  summary: VisualDiffSummary;
}

/**
 * Compute rendered pixel dimensions for both pages of a pair at the **exact
 * same DPI** (points-to-pixels scale factor), keeping each within PDFium's
 * bitmap limits while preserving relative page size differences.
 *
 * @param leftInfo Left page geometry (or `null` for an added page).
 * @param rightInfo Right page geometry (or `null` for a removed page).
 * @param requestedWidth Target width in pixels for the wider of the two pages.
 * @returns Pixel dimensions for left and right pages at identical DPI.
 */
export function alignedRenderDimensions(
  leftInfo: PageInfo | null,
  rightInfo: PageInfo | null,
  requestedWidth: number,
): {
  leftSize: { width: number; height: number } | null;
  rightSize: { width: number; height: number } | null;
} {
  const leftView = leftInfo ? viewSize(leftInfo.box, leftInfo.rotation) : null;
  const rightView = rightInfo
    ? viewSize(rightInfo.box, rightInfo.rotation)
    : null;

  const maxViewWidth = Math.max(
    leftView?.width ?? 0,
    rightView?.width ?? 0,
    1,
  );
  const maxViewHeight = Math.max(
    leftView?.height ?? 0,
    rightView?.height ?? 0,
    1,
  );

  const envelope = fitRenderSize(
    { width: maxViewWidth, height: maxViewHeight },
    requestedWidth,
  );
  const scale = envelope.width / maxViewWidth;

  const scaleView = (view: { width: number; height: number }) =>
    fitRenderSize(view, Math.max(1, Math.round(view.width * scale)));

  return {
    leftSize: leftView ? scaleView(leftView) : null,
    rightSize: rightView ? scaleView(rightView) : null,
  };
}

/** Manages the active comparison session inside the Web Worker. */
export class CompareSession {
  private readonly heap: WasmHeap;
  private readonly extractor: PdfTextExtractor;
  private readonly pixelDiffer: PixelDiffer;
  private readonly reportBuilder: ComparisonReportBuilder;

  private left: SideState | null = null;
  private right: SideState | null = null;
  private summary: CompareSummary | null = null;
  private readonly visualDiffs = new Map<number, VisualDiffSummary>();

  /**
   * @param api Segregated PDFium WASM API.
   * @param deps Optional injectable collaborators (for unit testing).
   */
  constructor(
    private readonly api: ComparePdfiumApi,
    deps: {
      extractor?: PdfTextExtractor;
      pixelDiffer?: PixelDiffer;
      reportBuilder?: ComparisonReportBuilder;
    } = {},
  ) {
    this.heap = new WasmHeap(api.pdfium);
    this.extractor =
      deps.extractor ?? new PdfiumPageTextExtractor(api, this.heap);
    this.pixelDiffer = deps.pixelDiffer ?? new CpuPixelDiffer();
    this.reportBuilder =
      deps.reportBuilder ?? new PdfiumComparisonReportBuilder(api, this.heap);
  }

  /**
   * Open a PDF on `side`, extract its page text and boxes, and automatically
   * compute the alignment + word-level diff when both sides are open.
   *
   * @param side Which slot (`"left"` or `"right"`) to load into.
   * @param fileName Original filename for the comparison report.
   * @param bytes Raw PDF file bytes.
   * @param password User password, or `""` for none.
   * @param onProgress Optional extraction progress callback in `[0, 1]`.
   * @returns Page count, scanned-page count, and comparison summary if both sides are open.
   */
  openSide(
    side: DocSide,
    fileName: string,
    bytes: Uint8Array,
    password: string,
    onProgress?: (fraction: number, stage: string) => void,
  ): OpenSideOutcome {
    this.closeSide(side);

    const doc = PdfiumDocument.open(this.api, this.heap, bytes, password);
    const pages: ExtractedPageText[] = [];
    try {
      const pageCount = doc.pageCount();
      for (let i = 0; i < pageCount; i++) {
        pages.push(this.extractor.extractPage(doc, i));
        onProgress?.(
          (i + 1) / Math.max(1, pageCount),
          `Reading ${side === "left" ? "original" : "revised"} page ${i + 1} of ${pageCount}…`,
        );
      }

      const state: SideState = { fileName, doc, pages };
      if (side === "left") this.left = state;
      else this.right = state;

      this.visualDiffs.clear();
      this.summary =
        this.left && this.right
          ? this.computeComparison(this.left, this.right)
          : null;

      return {
        side,
        pageCount,
        scannedPages: pages.filter((p) => !p.hasText).length,
        summary: this.summary,
      };
    } catch (err) {
      doc.close();
      throw err;
    }
  }

  /**
   * Render one page of `side` at `requestedWidth` pixels.
   *
   * @param side `"left"` or `"right"`.
   * @param pageIndex Zero-based page index in that document.
   * @param requestedWidth Desired bitmap width in pixels.
   * @returns RGBA bitmap pixels and size.
   * @throws When that side has no open document or `pageIndex` is out of range.
   */
  renderPage(
    side: DocSide,
    pageIndex: number,
    requestedWidth: number,
  ): RenderedPage {
    const state = side === "left" ? this.left : this.right;
    if (!state) {
      throw new Error(
        `No ${side === "left" ? "original" : "revised"} PDF is currently open.`,
      );
    }
    const page = state.pages[pageIndex];
    if (!page) {
      throw new Error(`Page ${pageIndex + 1} does not exist in ${state.fileName}.`);
    }
    const size = fitRenderSize(
      viewSize(page.info.box, page.info.rotation),
      requestedWidth,
    );
    return state.doc.render(pageIndex, size.width, size.height, 0);
  }

  /**
   * Render both pages of aligned `pairIndex` at identical DPI and compute the
   * per-pixel visual difference overlay and change regions.
   *
   * @param pairIndex Zero-based index into `summary.pairs`.
   * @param requestedWidth Target pixel width for the larger page.
   * @param threshold Optional per-channel RGB tolerance (`0..255`).
   * @returns RGBA visual diff bitmap and {@link VisualDiffSummary}.
   * @throws When the comparison is not ready or `pairIndex` is invalid.
   */
  computeVisualDiff(
    pairIndex: number,
    requestedWidth: number,
    threshold?: number,
  ): ComputedVisualDiff {
    if (!this.left || !this.right || !this.summary) {
      throw new Error("Open both PDFs before running visual comparison.");
    }
    const pair = this.summary.pairs[pairIndex];
    if (!pair) {
      throw new Error(`Invalid page pair index ${pairIndex}.`);
    }

    const { leftSize, rightSize } = alignedRenderDimensions(
      pair.leftInfo,
      pair.rightInfo,
      requestedWidth,
    );

    const leftRender =
      pair.leftIndex !== null && leftSize
        ? this.left.doc.render(
            pair.leftIndex,
            leftSize.width,
            leftSize.height,
            0,
          )
        : null;
    const rightRender =
      pair.rightIndex !== null && rightSize
        ? this.right.doc.render(
            pair.rightIndex,
            rightSize.width,
            rightSize.height,
            0,
          )
        : null;

    const fallbackW = leftRender?.width ?? rightRender?.width ?? 1;
    const fallbackH = leftRender?.height ?? rightRender?.height ?? 1;
    const blank = () => new Uint8Array(fallbackW * fallbackH * 4).fill(255);

    const output = this.pixelDiffer.compute({
      pairIndex,
      leftPixels: leftRender ? leftRender.pixels : blank(),
      leftWidth: leftRender ? leftRender.width : fallbackW,
      leftHeight: leftRender ? leftRender.height : fallbackH,
      rightPixels: rightRender ? rightRender.pixels : blank(),
      rightWidth: rightRender ? rightRender.width : fallbackW,
      rightHeight: rightRender ? rightRender.height : fallbackH,
      threshold,
    });

    this.visualDiffs.set(pairIndex, output.summary);
    return output;
  }

  /**
   * Build the downloadable Comparison Report PDF with summary cover page(s)
   * and PDF Highlight annotations for all text changes (plus any computed
   * visual diff regions).
   *
   * @returns Serialised PDF file bytes.
   * @throws When both PDFs are not currently open.
   */
  buildReport(): Uint8Array {
    if (!this.left || !this.right || !this.summary) {
      throw new Error("Open both PDFs before exporting a comparison report.");
    }
    return this.reportBuilder.buildReport({
      summary: this.summary,
      leftDoc: this.left.doc,
      rightDoc: this.right.doc,
      visualDiffs: this.visualDiffs,
    });
  }

  /**
   * Close one side's PDFium document and clear comparison state.
   *
   * @param side `"left"` or `"right"`.
   */
  closeSide(side: DocSide): void {
    if (side === "left") {
      this.left?.doc.close();
      this.left = null;
    } else {
      this.right?.doc.close();
      this.right = null;
    }
    this.summary = null;
    this.visualDiffs.clear();
  }

  /** Close both documents and release all WASM memory. */
  closeAll(): void {
    this.closeSide("left");
    this.closeSide("right");
  }

  /**
   * Align pages across `left` and `right` and compute word-level diffs for
   * every aligned slot.
   *
   * @param left Original document state.
   * @param right Revised document state.
   * @returns Full {@link CompareSummary}.
   */
  private computeComparison(
    left: SideState,
    right: SideState,
  ): CompareSummary {
    const toSignatures = (
      pages: readonly ExtractedPageText[],
    ): PageSignature[] =>
      pages.map((p) => {
        const size = boxSize(p.info.box);
        const view = viewSize(p.info.box, p.info.rotation);
        const ratio =
          view.height > 0
            ? view.width / view.height
            : size.width / (size.height || 1);
        return {
          pageIndex: p.pageIndex,
          words: p.tokens.map((t) => t.normalizedText),
          aspectRatio: ratio,
        };
      });

    const aligned = alignPages(
      toSignatures(left.pages),
      toSignatures(right.pages),
    );

    let totalChanges = 0;
    let addedWords = 0;
    let removedWords = 0;

    const pairs: AlignedPagePair[] = aligned.map((entry, pairIndex) => {
      const leftPage =
        entry.leftIndex !== null ? left.pages[entry.leftIndex] : null;
      const rightPage =
        entry.rightIndex !== null ? right.pages[entry.rightIndex] : null;
      const changes = diffPageText(pairIndex, leftPage, rightPage);

      totalChanges += changes.length;
      for (const ch of changes) {
        if (ch.rightText) {
          addedWords += ch.rightText.split(/\s+/).filter(Boolean).length;
        }
        if (ch.leftText) {
          removedWords += ch.leftText.split(/\s+/).filter(Boolean).length;
        }
      }

      return {
        pairIndex,
        leftIndex: entry.leftIndex,
        rightIndex: entry.rightIndex,
        status: entry.status,
        similarity: entry.similarity,
        changes,
        leftHasText: leftPage?.hasText ?? false,
        rightHasText: rightPage?.hasText ?? false,
        leftInfo: leftPage?.info ?? null,
        rightInfo: rightPage?.info ?? null,
      };
    });

    const scannedPagesCount =
      left.pages.filter((p) => !p.hasText).length +
      right.pages.filter((p) => !p.hasText).length;

    return {
      leftFileName: left.fileName,
      rightFileName: right.fileName,
      leftPageCount: left.pages.length,
      rightPageCount: right.pages.length,
      pairs,
      totalChanges,
      addedWords,
      removedWords,
      scannedPagesCount,
    };
  }
}
