import { viewSize } from "@/lib/pdfium/page-box";
import {
  PdfOpenError,
  PdfiumDocument,
  type PageInfo,
  type RenderedPage,
} from "@/lib/pdfium/pdfium-document";
import { fitRenderSize } from "@/lib/pdfium/render-size";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { FontMetricsSource } from "@/tools/edit/core/text-layout";
import type { RedactionMark, RedactionReport } from "../core/model";
import {
  createPlainTextMatcher,
  createRegexMatcher,
  getPresetMatcher,
  type PatternMatcher,
} from "../core/presets";
import { encodeSanitizePlan, sanitizeRedactionPlan } from "../core/sanitize-plan";
import {
  extractTextUnderBox,
  locatePatternMatchesOnPage,
  type PageCharWithBox,
} from "../core/text-search";
import { PageRedactor } from "./page-redactor";
import { readPageCharsWithBoxes } from "./page-text-extractor";
import type { RedactSanitizer } from "./pdf-redact-module";
import type { RedactPdfiumApi } from "./redact-pdfium-api";
import { RedactionVerifier } from "./redaction-verifier";
import type { SearchQuery } from "../messages";

/** Error thrown when `pdf-redact.wasm` fails to sanitize the object graph. */
export class RedactModuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RedactModuleError";
  }
}

/** Progress stages emitted by {@link RedactSession.applyRedactions}. */
export type RedactStage = "redacting" | "cleaning" | "verifying";

/** Successful redaction output returned to the worker handler. */
export interface RedactOutcome {
  pdf: Uint8Array;
  report: RedactionReport;
}

/**
 * Worker-side session holding one opened PDF document and orchestrating search,
 * preview rendering, surgical PDFium redaction, WASM object-graph cleanup, and
 * post-save verification.
 */
export class RedactSession {
  private readonly heap: WasmHeap;
  private readonly pageRedactor: PageRedactor;
  private readonly verifier: RedactionVerifier;
  private view: PdfiumDocument | null = null;
  private source: { bytes: Uint8Array; password: string } | null = null;
  private pages: PageInfo[] = [];
  private charCache = new Map<number, PageCharWithBox[]>();

  /**
   * @param api PDFium WASM module.
   * @param metrics Standard font metrics for fallback text and labels.
   * @param loadSanitizer Lazy loader for `pdf-redact.wasm` (Dependency Inversion).
   */
  constructor(
    private readonly api: RedactPdfiumApi,
    metrics: FontMetricsSource,
    private readonly loadSanitizer: () => Promise<RedactSanitizer>,
  ) {
    this.heap = new WasmHeap(api.pdfium);
    this.pageRedactor = new PageRedactor(api, this.heap, metrics);
    this.verifier = new RedactionVerifier(api, this.heap);
  }

  /**
   * Open a PDF document from bytes (with optional password).
   *
   * @param bytes Raw PDF file bytes.
   * @param password Document user password, or `""` when unencrypted.
   * @returns Metadata for every page in the document.
   * @throws {PdfOpenError} When password is required/incorrect or file is invalid.
   */
  open(bytes: Uint8Array, password: string): PageInfo[] {
    this.close();
    const view = PdfiumDocument.open(this.api, this.heap, bytes, password);
    try {
      const count = view.pageCount();
      if (count < 1) throw new Error("This PDF has no pages.");
      this.pages = Array.from({ length: count }, (_, i) => view.pageInfo(i));
    } catch (err) {
      view.close();
      if (err instanceof PdfOpenError) throw err;
      throw err;
    }
    this.view = view;
    this.source = { bytes, password };
    return this.pages;
  }

  /**
   * Render one page for the interactive review preview.
   *
   * @param pageIndex Zero-based page index.
   * @param width Target bitmap width in pixels.
   * @returns RGBA pixels sized to fit `width`.
   */
  render(pageIndex: number, width: number): RenderedPage {
    const view = this.requireView();
    const info = this.requirePage(pageIndex);
    const size = fitRenderSize(viewSize(info.box, info.rotation), width);
    return view.render(pageIndex, size.width, size.height, 0);
  }

  /**
   * Extract readable text lying under a manually drawn user-space box.
   *
   * @param pageIndex Zero-based page index.
   * @param box User-space redaction box.
   * @returns Extracted text string (empty for graphics-only regions).
   */
  textUnderBox(pageIndex: number, box: PageInfo["box"]): string {
    this.requireView();
    this.requirePage(pageIndex);
    return extractTextUnderBox(this.pageChars(pageIndex), box);
  }

  /**
   * Search across all pages for matches of a plain text query, regex, or one or
   * more built-in sensitive-data presets.
   *
   * @param query Search mode and parameters.
   * @returns Candidate redaction marks across all pages.
   */
  search(query: SearchQuery): Omit<RedactionMark, "id">[] {
    this.requireView();
    const matchers = this.buildMatchers(query);
    const results: Omit<RedactionMark, "id">[] = [];
    for (let pageIdx = 0; pageIdx < this.pages.length; pageIdx++) {
      const chars = this.pageChars(pageIdx);
      for (const matcher of matchers) {
        results.push(...locatePatternMatchesOnPage(pageIdx, chars, matcher));
      }
    }
    return results;
  }

  /**
   * Execute permanent redaction on a fresh copy of the source document, scrub
   * document-wide metadata/attachments/scripts/layers/bookmarks and prune all
   * unreachable objects via `pdf-redact.wasm`, then reopen and verify that zero
   * redacted terms remain before returning bytes.
   *
   * @param rawPlan Untrusted redaction plan from the UI.
   * @param onProgress Optional progress reporter.
   * @returns Redacted single-revision PDF bytes and verified report.
   * @throws {InvalidRedactionPlanError} When the plan is invalid.
   * @throws {RedactModuleError} When `pdf-redact.wasm` fails.
   * @throws {RedactionVerificationError} When any redacted term survives verification.
   */
  async applyRedactions(
    rawPlan: unknown,
    onProgress?: (stage: RedactStage, fraction: number) => void,
  ): Promise<RedactOutcome> {
    this.requireView();
    const source = this.source!;
    const plan = sanitizeRedactionPlan(rawPlan, this.pages.length);

    const enabledMarks = plan.marks.filter((m) => m.enabled);
    const marksByPage = new Map<number, RedactionMark[]>();
    for (const mark of enabledMarks) {
      let list = marksByPage.get(mark.pageIndex);
      if (!list) {
        list = [];
        marksByPage.set(mark.pageIndex, list);
      }
      list.push(mark);
    }

    onProgress?.("redacting", 0);
    const workDoc = PdfiumDocument.open(
      this.api,
      this.heap,
      source.bytes,
      source.password,
    );

    let textObjectsRemoved = 0;
    let textObjectsSplit = 0;
    let imagesModified = 0;
    let pathsRemoved = 0;
    let annotationsRemoved = 0;
    let pagesRasterized = 0;
    let pdfAfterPageRedaction: Uint8Array;

    try {
      // Remove encryption on the working copy before saving if protected so
      // `pdf-redact.wasm` can inspect and prune the object graph cleanly.
      if (this.api.FPDF_GetSecurityHandlerRevision(workDoc.handle) !== -1) {
        this.api.EPDF_RemoveEncryption(workDoc.handle);
      }

      const targetPages = [...marksByPage.keys()].sort((a, b) => a - b);
      for (let i = 0; i < targetPages.length; i++) {
        const pageIndex = targetPages[i];
        const pageMarks = marksByPage.get(pageIndex)!;
        const pageInfo = this.pages[pageIndex];
        const boxes = pageMarks.map((m) => m.box);

        const stats = workDoc.withPage(pageIndex, (page) =>
          this.pageRedactor.redactPage(
            workDoc.handle,
            page,
            pageInfo,
            boxes,
            plan.style,
          ),
        );
        textObjectsRemoved += stats.textObjectsRemoved;
        textObjectsSplit += stats.textObjectsSplit;
        imagesModified += stats.imagesModified;
        pathsRemoved += stats.pathsRemoved;
        annotationsRemoved += stats.annotationsRemoved;

        if (plan.rasterizePages) {
          this.pageRedactor.rasterizePage(workDoc, pageIndex, pageInfo);
          pagesRasterized++;
        }

        onProgress?.("redacting", (i + 1) / Math.max(1, targetPages.length));
      }

      pdfAfterPageRedaction = workDoc.save();
    } finally {
      workDoc.close();
    }

    // Stage 2: Object-graph cleanup, incremental-revision purge, and single-revision write.
    onProgress?.("cleaning", 0);
    const sanitizer = await this.loadSanitizer();
    const uniqueTerms = [
      ...new Set(
        enabledMarks
          .map((m) => m.term.trim())
          .filter((t) => t.length > 0),
      ),
    ];
    const encodedSanitizePlan = encodeSanitizePlan(
      plan.cleanup,
      plan.style.label,
      uniqueTerms,
      enabledMarks.map((m) => ({ pageIndex: m.pageIndex, box: m.box })),
    );
    const sanitized = sanitizer.sanitize(
      pdfAfterPageRedaction,
      encodedSanitizePlan,
    );
    if (!sanitized.ok) {
      throw new RedactModuleError(sanitized.code, sanitized.message);
    }
    onProgress?.("cleaning", 1);

    // Stage 3: Mandatory post-save verification pass (refuses download on any leak).
    onProgress?.("verifying", 0);
    const verification = this.verifier.verify(
      sanitized.pdf,
      plan.marks,
      plan.style.label,
      (f) => onProgress?.("verifying", f),
    );
    onProgress?.("verifying", 1);

    return {
      pdf: sanitized.pdf,
      report: {
        pagesRedacted: marksByPage.size,
        marksApplied: enabledMarks.length,
        textObjectsRemoved,
        textObjectsSplit,
        imagesModified,
        pathsRemoved,
        annotationsRemoved:
          annotationsRemoved + sanitized.report.annotationsRemoved,
        pagesRasterized,
        sanitize: sanitized.report,
        verification,
      },
    };
  }

  /** Close the open document and clear cached bytes and character maps. */
  close(): void {
    this.view?.close();
    this.view = null;
    this.source = null;
    this.pages = [];
    this.charCache.clear();
  }

  private pageChars(pageIndex: number): PageCharWithBox[] {
    const cached = this.charCache.get(pageIndex);
    if (cached) return cached;
    const extracted = this.requireView().withPage(pageIndex, (page) =>
      readPageCharsWithBoxes(this.api, this.heap, page),
    );
    this.charCache.set(pageIndex, extracted);
    return extracted;
  }

  private buildMatchers(query: SearchQuery): PatternMatcher[] {
    switch (query.mode) {
      case "text":
        return [createPlainTextMatcher(query.query, query.caseSensitive)];
      case "regex":
        return [createRegexMatcher(query.pattern, query.caseSensitive)];
      case "presets":
        return query.presets.map((id) => getPresetMatcher(id));
    }
  }

  private requireView(): PdfiumDocument {
    if (!this.view) throw new Error("No PDF is open.");
    return this.view;
  }

  private requirePage(pageIndex: number): PageInfo {
    const info = this.pages[pageIndex];
    if (!info) throw new Error(`There is no page ${pageIndex + 1}.`);
    return info;
  }
}
