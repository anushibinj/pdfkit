import {
  addTurns,
  viewSize,
  type PageInfo,
  type QuarterTurns,
} from "@/lib/pdfium/page-box";
import {
  PdfiumDocument,
  type RenderedPage,
} from "@/lib/pdfium/pdfium-document";
import { fitRenderSize } from "@/lib/pdfium/render-size";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { planImports } from "../core/import-plan";
import { isSourceId, sanitizeOutputPlan } from "../core/output-plan";
import { assembleDocument } from "./assemble";
import type { OrganizePdfiumApi } from "./organize-pdfium-api";

/** One opened file: its PDFium document and its pages' boxes. */
interface OpenSource {
  doc: PdfiumDocument;
  pages: PageInfo[];
}

/**
 * The organizer worker's state: every opened file at once.
 *
 * Unlike the editor, which keeps one file, the organizer keeps all files
 * open in one PDFium instance, because the output is built by importing
 * pages from each of them (`FPDF_ImportPagesByIndex` needs both documents
 * open in the same instance).
 *
 * The opened files are never modified. Thumbnails render from them, and
 * saving builds a brand-new document (`PdfiumDocument.create`) that is
 * closed again right after it is serialised, so saving twice never applies
 * anything twice.
 */
export class OrganizeSession {
  private readonly heap: WasmHeap;
  private readonly sources = new Map<string, OpenSource>();

  /** @param api The initialised PDFium module. */
  constructor(private readonly api: OrganizePdfiumApi) {
    this.heap = new WasmHeap(api.pdfium);
  }

  /**
   * Open a file under `sourceId`, replacing a file already open under that
   * id (a retry with a password, say).
   *
   * @param sourceId The UI's id for the file (untrusted: checked).
   * @param bytes The PDF file.
   * @param password The user password, or "" for none.
   * @returns Every page's box and rotation.
   * @throws {PdfOpenError} When PDFium refuses the file; an `Error` for an
   *   invalid id or a file without pages.
   */
  open(sourceId: unknown, bytes: Uint8Array, password: string): PageInfo[] {
    if (!isSourceId(sourceId)) throw new Error("Invalid file id.");
    this.close(sourceId);
    const doc = PdfiumDocument.open(this.api, this.heap, bytes, password);
    try {
      const count = doc.pageCount();
      if (count < 1) throw new Error("This PDF has no pages.");
      const pages = Array.from({ length: count }, (_, i) => doc.pageInfo(i));
      this.sources.set(sourceId, { doc, pages });
      return pages;
    } catch (err) {
      doc.close();
      throw err;
    }
  }

  /**
   * Render a page of an opened file, turned by the user's rotation.
   *
   * @param sourceId The file.
   * @param pageIndex Page index in that file.
   * @param turns Clockwise quarter turns to add to the page's /Rotate.
   * @param width Requested bitmap width in pixels (clamped by
   *   `fitRenderSize`; the height follows the turned page's shape).
   * @returns RGBA pixels.
   * @throws When the file is not open or the page does not exist.
   */
  render(
    sourceId: unknown,
    pageIndex: number,
    turns: QuarterTurns,
    width: number,
  ): RenderedPage {
    const { doc, pages } = this.require(sourceId);
    const info = pages[pageIndex];
    if (!info) throw new Error(`There is no page ${pageIndex + 1}.`);
    const size = fitRenderSize(
      viewSize(info.box, addTurns(info.rotation, turns)),
      width,
    );
    return doc.render(pageIndex, size.width, size.height, turns);
  }

  /**
   * Build and serialise the organized file.
   *
   * The plan crossed a thread boundary, so it is sanitised against the
   * files that are actually open before anything is built. The new
   * document is always closed, whether building and saving worked or not.
   *
   * @param rawPages The output pages from the UI (untrusted).
   * @returns The organized PDF's bytes.
   * @throws {InvalidOutputPlanError} for a bad plan, or a PDFium failure.
   */
  save(rawPages: unknown): Uint8Array {
    const counts = new Map(
      [...this.sources].map(([id, s]) => [id, s.pages.length]),
    );
    const plan = planImports(sanitizeOutputPlan(rawPages, counts));
    const dest = PdfiumDocument.create(this.api, this.heap);
    try {
      assembleDocument(dest, plan, {
        api: this.api,
        heap: this.heap,
        source: (id) => this.require(id).doc,
      });
      return dest.save();
    } finally {
      dest.close();
    }
  }

  /**
   * Close one file, or every file when no id is given. Unknown ids are
   * ignored, so closing twice is safe.
   *
   * @param sourceId The file to close; omit to close all.
   */
  close(sourceId?: unknown): void {
    if (sourceId === undefined) {
      for (const { doc } of this.sources.values()) doc.close();
      this.sources.clear();
      return;
    }
    if (typeof sourceId !== "string") return;
    this.sources.get(sourceId)?.doc.close();
    this.sources.delete(sourceId);
  }

  /** @returns The ids of the open files, in the order they were opened. */
  openIds(): string[] {
    return [...this.sources.keys()];
  }

  /**
   * @param sourceId A file id.
   * @returns The open file.
   * @throws When no file is open under that id.
   */
  private require(sourceId: unknown): OpenSource {
    const source =
      typeof sourceId === "string" ? this.sources.get(sourceId) : undefined;
    if (!source) throw new Error("That file is not open any more.");
    return source;
  }
}
