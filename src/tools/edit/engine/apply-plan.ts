import { addTurns } from "../core/page-geometry";
import { planPageOperations } from "../core/page-order";
import type { SavePlan } from "../core/save-plan";
import type { FontMetricsSource } from "../core/text-layout";
import { PdfiumPageText } from "./page-text";
import type { PdfiumApi } from "./pdfium-api";
import type { PdfiumDocument } from "./pdfium-document";
import { applyTextEdits } from "./text-edits";
import type { WasmHeap } from "./wasm-heap";
import { check } from "./writers/object-writer";
import { writePageObjects, type WriterRegistry } from "./writers/registry";

/** Collaborators for {@link applySavePlan}. */
export interface ApplyDeps {
  api: PdfiumApi;
  heap: WasmHeap;
  writers: WriterRegistry;
  /** Standard font metrics, for text that falls back to a standard font. */
  metrics: FontMetricsSource;
}

/**
 * Apply a (sanitised) save plan to an open document, in place.
 *
 * Order of work, and why:
 * 1. Per page, by **source** index: edit the existing text, draw the new
 *    objects and set the rotation. Source indices are only valid while no
 *    page has been deleted or moved, so content edits come first.
 *    - Text edits come before new objects: lines are identified by the
 *      object indices of the original page, and a newly added text object
 *      could otherwise be read as part of an existing line.
 *    - `FPDFPage_GenerateContent` rewrites the page's content from PDFium's
 *      in-memory objects. Without it every change would be lost when the
 *      page closes. It is called only on pages that changed, so untouched
 *      pages keep their original content stream byte for byte.
 *    - The final /Rotate is the page's own rotation plus the user's turns.
 * 2. Delete the pages that are not in the plan, highest index first.
 * 3. Reorder the rest with one `FPDF_MovePages` call (see
 *    `planPageOperations` for the index arithmetic).
 *
 * @param doc A document opened from the original file (not the one used for
 *   on-screen rendering, which must stay unedited).
 * @param plan A plan that went through `sanitizeSavePlan`.
 * @param deps PDFium, its memory helper, the object writers and metrics.
 * @throws When PDFium rejects a step; the caller discards the document.
 */
export function applySavePlan(
  doc: PdfiumDocument,
  plan: SavePlan,
  deps: ApplyDeps,
): void {
  const { api, heap, writers, metrics } = deps;
  const images = new Map(plan.images.map((image) => [image.id, image]));

  for (const page of plan.pages) {
    const changesContent = page.textEdits.length > 0 || page.objects.length > 0;
    if (!changesContent && page.rotation === 0) continue;
    doc.withPage(page.sourceIndex, (handle) => {
      if (page.textEdits.length > 0) {
        applyTextEdits(
          new PdfiumPageText(api, heap, doc.handle, handle),
          page.textEdits,
          metrics,
        );
      }
      if (page.objects.length > 0) {
        writePageObjects(writers, page.objects, {
          api,
          heap,
          doc: doc.handle,
          page: handle,
          images,
        });
      }
      if (changesContent) {
        check(api.FPDFPage_GenerateContent(handle), "save the page content");
      }
      if (page.rotation !== 0) {
        api.FPDFPage_SetRotation(
          handle,
          addTurns(api.FPDFPage_GetRotation(handle), page.rotation),
        );
      }
    });
  }

  const { deletions, moveOrder } = planPageOperations(
    doc.pageCount(),
    plan.pages.map((p) => p.sourceIndex),
  );
  for (const index of deletions) api.FPDFPage_Delete(doc.handle, index);
  if (moveOrder) {
    heap.using(heap.ints(moveOrder), (indices) =>
      check(
        api.FPDF_MovePages(doc.handle, indices, moveOrder.length, 0),
        "reorder the pages",
      ),
    );
  }
}
