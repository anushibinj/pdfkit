/**
 * Build the organized document with PDFium, following an `ImportPlan`.
 *
 * Every step works on the page tree only (`/Pages`, `/Rotate`): page
 * content is copied as it is, never re-drawn, so text stays text and
 * nothing is rasterised.
 */
import { addTurns, type QuarterTurns } from "@/lib/pdfium/page-box";
import { check } from "@/lib/pdfium/page-objects";
import { planPageOperations } from "@/lib/pdfium/page-order";
import type { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { BlankSpec, ImportBatch, ImportPlan } from "../core/import-plan";
import type { OrganizePdfiumApi } from "./organize-pdfium-api";

/** Collaborators for {@link assembleDocument}. */
export interface AssembleDeps {
  api: OrganizePdfiumApi;
  heap: WasmHeap;
  /**
   * The open document of a file.
   *
   * @throws For an id that is not open (the plan was sanitised against the
   *   open files, so this only guards against bugs).
   */
  source(sourceId: string): PdfiumDocument;
}

/**
 * Append the pages of one batch to the end of `dest` with a single
 * `FPDF_ImportPagesByIndex` call (see `planImports` for why one call per
 * batch matters).
 *
 * The page index list is C memory (`int*`), freed whatever happens.
 *
 * @param dest The document being built.
 * @param batch Which file and which of its pages, in order.
 * @param deps PDFium, its memory helper and the open files.
 * @throws When PDFium refuses the import.
 */
export function importBatch(
  dest: PdfiumDocument,
  batch: ImportBatch,
  deps: AssembleDeps,
): void {
  const { api, heap } = deps;
  const src = deps.source(batch.sourceId);
  heap.using(heap.ints(batch.pageIndices), (indices) =>
    check(
      api.FPDF_ImportPagesByIndex(
        dest.handle,
        src.handle,
        indices,
        batch.pageIndices.length,
        dest.pageCount(),
      ),
      "copy the pages of a file",
    ),
  );
}

/**
 * Append an empty page to the end of `dest`.
 *
 * The shared `withNewPage` creates the page in the document and closes the
 * loaded handle again (the page itself stays). Nothing is drawn on it: a
 * page with a MediaBox, empty resources and no content stream is a valid,
 * empty page, so no content needs generating.
 *
 * @param dest The document being built.
 * @param spec Width and height in points.
 * @throws {RangeError} When PDFium cannot create the page.
 */
export function appendBlankPage(dest: PdfiumDocument, spec: BlankSpec): void {
  dest.withNewPage(dest.pageCount(), spec.width, spec.height, () => {});
}

/**
 * Put every page of `dest` in its output position with one
 * `FPDF_MovePages` call.
 *
 * `moveOrder[i]` is the current index of the page that belongs at output
 * position i. Moving *all* pages, in that order, to index 0 leaves them in
 * exactly that order. The shared `planPageOperations` does the
 * validation: it rejects duplicates and out-of-range indices, and reports
 * the order as `null` when the pages are already in place. Because the
 * order lists every page, it must plan no deletions; if it does, the plan
 * and the document disagree and building stops rather than drop a page.
 *
 * @param dest The document being built, with every page appended.
 * @param moveOrder The plan's move order (a permutation of the indices).
 * @param deps PDFium and its memory helper.
 * @throws When the order does not cover every page exactly once, or PDFium
 *   refuses the move.
 */
export function reorderPages(
  dest: PdfiumDocument,
  moveOrder: readonly number[],
  deps: Pick<AssembleDeps, "api" | "heap">,
): void {
  const { api, heap } = deps;
  const { deletions, moveOrder: order } = planPageOperations(
    dest.pageCount(),
    moveOrder,
  );
  if (deletions.length > 0) {
    throw new Error("The page order does not cover every page.");
  }
  if (!order) return;
  heap.using(heap.ints(order), (indices) =>
    check(
      api.FPDF_MovePages(dest.handle, indices, order.length, 0),
      "reorder the pages",
    ),
  );
}

/**
 * Add the user's quarter turns to each page's own /Rotate.
 *
 * Imported pages keep their /Rotate (PDFium copies inherited attributes
 * onto the page), so the final value is that plus the user's turns. Setting
 * /Rotate changes only the page dictionary, which is saved without
 * regenerating the content stream; pages with no turns are not even
 * loaded.
 *
 * @param dest The document, pages in output order.
 * @param rotations Quarter turns per output position.
 * @param api The PDFium module.
 */
export function rotatePages(
  dest: PdfiumDocument,
  rotations: readonly QuarterTurns[],
  api: OrganizePdfiumApi,
): void {
  rotations.forEach((turns, index) => {
    if (turns === 0) return;
    dest.withPage(index, (page) =>
      api.FPDFPage_SetRotation(
        page,
        addTurns(api.FPDFPage_GetRotation(page), turns),
      ),
    );
  });
}

/**
 * Build the organized document: import each batch, append the blank
 * pages, move everything into output order, then rotate.
 *
 * Rotation comes last because `rotations` is indexed by *output* position,
 * which only exists once the pages are in order.
 *
 * @param dest A new, empty document (`PdfiumDocument.create`).
 * @param plan The import plan.
 * @param deps PDFium, its memory helper and the open files.
 * @throws When any PDFium step fails; the caller discards `dest`.
 */
export function assembleDocument(
  dest: PdfiumDocument,
  plan: ImportPlan,
  deps: AssembleDeps,
): void {
  for (const batch of plan.batches) importBatch(dest, batch, deps);
  for (const blank of plan.blanks) appendBlankPage(dest, blank);
  reorderPages(dest, plan.moveOrder, deps);
  rotatePages(dest, plan.rotations, deps.api);
}
