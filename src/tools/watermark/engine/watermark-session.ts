import { viewSize, type Size } from "@/lib/pdfium/page-box";
import {
  PdfiumDocument,
  type RenderedPage,
} from "@/lib/pdfium/pdfium-document";
import { fitRenderSize } from "@/lib/pdfium/render-size";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { QpdfEngine } from "@/lib/qpdf/qpdf-runner";
import {
  sanitizePageIndices,
  sanitizeSettings,
} from "../core/sanitize-settings";
import { planStamps } from "../core/stamp-plan";
import type { PainterRegistry } from "./painters/painter";
import { readPlacementSize } from "./placement-size";
import { QpdfStamper } from "./qpdf-stamper";
import { StampBuilder } from "./stamp-builder";
import type { WatermarkPdfiumApi } from "./watermark-pdfium-api";

/** What the session remembers about the open file. */
interface OpenFile {
  password: string;
  /** Each page's displayed size (see `readPlacementSize`). */
  sizes: Size[];
}

/**
 * The worker's state for one opened PDF, and the three things the UI can
 * ask for: open, preview a page, and produce the watermarked file.
 *
 * Who does what:
 * - PDFium opens the file once to check the password and read every
 *   page's size, then closes it again (its copy of the file is freed);
 * - qpdf keeps the file for the session (`QpdfStamper.load`) and lays the
 *   stamps onto it;
 * - `StampBuilder` draws the stamps with PDFium;
 * - previews are the real qpdf output for one page, rendered by PDFium.
 * Settings and page lists arrive from another thread and are validated
 * before use.
 */
export class WatermarkSession {
  private readonly heap: WasmHeap;
  private readonly stamps: StampBuilder;
  private readonly stamper: QpdfStamper;
  private file: OpenFile | null = null;

  /**
   * @param api The initialised PDFium module.
   * @param qpdf A ready qpdf instance.
   * @param painters One painter per content kind.
   */
  constructor(
    private readonly api: WatermarkPdfiumApi,
    qpdf: QpdfEngine,
    painters: PainterRegistry,
  ) {
    this.heap = new WasmHeap(api.pdfium);
    this.stamps = new StampBuilder(api, this.heap, painters);
    this.stamper = new QpdfStamper(qpdf);
  }

  /** @returns Whether a file is open. */
  isOpen(): boolean {
    return this.file !== null;
  }

  /**
   * Open a file, replacing any open one.
   *
   * @param bytes The PDF.
   * @param password The user password, or "" for none.
   * @returns The number of pages.
   * @throws {PdfOpenError} When PDFium cannot open it (e.g. wrong password).
   */
  open(bytes: Uint8Array, password: string): number {
    this.close();
    const doc = PdfiumDocument.open(this.api, this.heap, bytes, password);
    let sizes: Size[];
    try {
      const count = doc.pageCount();
      if (count < 1) throw new Error("This PDF has no pages.");
      sizes = Array.from({ length: count }, (_, i) =>
        readPlacementSize(doc, this.api, this.heap, i),
      );
    } finally {
      doc.close();
    }
    this.stamper.load(bytes);
    this.file = { password, sizes };
    return sizes.length;
  }

  /**
   * Render one page as the download will show it.
   *
   * @param pageIndex 0-based page.
   * @param width Requested bitmap width in pixels.
   * @param rawSettings The watermark (untrusted), or `undefined` for the
   *   page without one (a page the user did not select).
   * @returns RGBA pixels, sized by `fitRenderSize`.
   * @throws When nothing is open, the page does not exist, the settings
   *   are invalid or an engine fails.
   */
  preview(
    pageIndex: number,
    width: number,
    rawSettings?: unknown,
  ): RenderedPage {
    const file = this.requireFile();
    const size = file.sizes[pageIndex];
    if (!Number.isInteger(pageIndex) || !size)
      throw new Error(`There is no page ${pageIndex + 1}.`);
    let stamp = null;
    if (rawSettings !== undefined) {
      const spec = sanitizeSettings(rawSettings);
      stamp = { stamp: this.stamps.build(spec, [size]), layer: spec.layer };
    }
    const bytes = this.stamper.stampPreview(file.password, pageIndex, stamp);
    const doc = PdfiumDocument.open(this.api, this.heap, bytes, file.password);
    try {
      const info = doc.pageInfo(0);
      const target = fitRenderSize(viewSize(info.box, info.rotation), width);
      return doc.render(0, target.width, target.height, 0);
    } finally {
      doc.close();
    }
  }

  /**
   * Produce the watermarked file.
   *
   * @param rawSettings The watermark (untrusted).
   * @param rawPages 0-based pages to watermark (untrusted).
   * @returns The new PDF's bytes.
   * @throws {InvalidSettingsError} For unusable settings or pages, or an
   *   engine failure.
   */
  apply(rawSettings: unknown, rawPages: unknown): Uint8Array {
    const file = this.requireFile();
    const spec = sanitizeSettings(rawSettings);
    const pages = sanitizePageIndices(rawPages, file.sizes.length);
    const plan = planStamps(
      pages.map((index) => ({ index, size: file.sizes[index] })),
    );
    return this.stamper.stampDocument(file.password, {
      stamp: this.stamps.build(spec, plan.stamps),
      layer: spec.layer,
      to: plan.to,
      from: plan.from,
    });
  }

  /** Forget the open file and free its copy. Safe to call when closed. */
  close(): void {
    this.stamper.unload();
    this.file = null;
  }

  /**
   * @returns The open file.
   * @throws When no file is open.
   */
  private requireFile(): OpenFile {
    if (!this.file) throw new Error("No PDF is open.");
    return this.file;
  }
}
