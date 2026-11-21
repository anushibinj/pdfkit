/**
 * How to build the organized file with PDFium's page-import API, as a pure
 * plan that can be tested without the engine.
 */
import type { QuarterTurns } from "@/lib/pdfium/page-box";
import type { OutputPage } from "./output-plan";

/** One `FPDF_ImportPagesByIndex` call: pages of one file, appended at the end. */
export interface ImportBatch {
  sourceId: string;
  /** Page indices in that file, in the order they are appended. */
  pageIndices: number[];
}

/** One `FPDFPage_New` call, appended after every batch. */
export interface BlankSpec {
  width: number;
  height: number;
}

/** Everything needed to assemble the organized document. */
export interface ImportPlan {
  /** Import calls, run in this order; each appends its pages. */
  batches: ImportBatch[];
  /** Blank pages, appended in this order after the batches. */
  blanks: BlankSpec[];
  /**
   * For output position i: where that page sits once every batch and blank
   * has been appended. `FPDF_MovePages(doc, moveOrder, n, 0)` then puts
   * every page in its output position in one call.
   */
  moveOrder: number[];
  /** Quarter turns to add to each output page's /Rotate, by output position. */
  rotations: QuarterTurns[];
}

/**
 * Plan the import calls that produce `pages`.
 *
 * Why batches, and why by occurrence:
 * - Importing one page per call would be simplest, but every call copies
 *   the objects its pages use (fonts, images) afresh. Interleaving two
 *   100-page files would then embed the same fonts 200 times. So each
 *   file's pages go into as few calls as possible, and are put in order
 *   afterwards with one `FPDF_MovePages`.
 * - Within one call PDFium copies a shared object only once, which is what
 *   saves the space, but it also copies a *page's own* objects only once.
 *   A page imported twice in one call (a duplicate) would make both copies
 *   share one annotation object whose /P points at only the first copy,
 *   which is invalid PDF (checked against the real WASM: the second copy's
 *   /Annots referenced the first copy's widget). So the k-th copy of a page
 *   goes into the k-th call for its file. Without duplicates that is one
 *   call per file.
 *
 * Worked example: output [A0, B0, A1, blank, A0, B1] (A0 = page 0 of file
 * A, used twice).
 * 1. Batches in order of first appearance: A#1 = [0, 1] (A0's first copy,
 *    A1), B#1 = [0, 1], A#2 = [0] (A0's second copy). Blanks: [blank].
 * 2. Appended order: A0 A1 B0 B1 A0' blank, at indices 0..5.
 * 3. moveOrder lists, for each output position, its appended index:
 *    A0 -> 0, B0 -> 2, A1 -> 1, blank -> 5, A0' -> 4, B1 -> 3, giving
 *    [0, 2, 1, 5, 4, 3].
 *
 * @param pages The sanitised output pages (at least one).
 * @returns The plan.
 */
export function planImports(pages: readonly OutputPage[]): ImportPlan {
  const batches: ImportBatch[] = [];
  const batchByKey = new Map<string, number>();
  const copiesSoFar = new Map<string, number>();
  const blanks: BlankSpec[] = [];
  // Where each output page lands: in batch b at position p, or blank #n.
  const slots: ({ batch: number; position: number } | { blank: number })[] = [];

  for (const page of pages) {
    if (page.kind === "blank") {
      slots.push({ blank: blanks.length });
      blanks.push({ width: page.width, height: page.height });
      continue;
    }
    const pageId = `${page.sourceId}\u0000${page.pageIndex}`;
    const copy = copiesSoFar.get(pageId) ?? 0;
    copiesSoFar.set(pageId, copy + 1);
    const batchKey = `${page.sourceId}\u0000#${copy}`;
    let batch = batchByKey.get(batchKey);
    if (batch === undefined) {
      batch = batches.length;
      batchByKey.set(batchKey, batch);
      batches.push({ sourceId: page.sourceId, pageIndices: [] });
    }
    slots.push({ batch, position: batches[batch].pageIndices.length });
    batches[batch].pageIndices.push(page.pageIndex);
  }

  // Each batch starts where the previous one ended; blanks follow them all.
  const offsets: number[] = [];
  let appended = 0;
  for (const batch of batches) {
    offsets.push(appended);
    appended += batch.pageIndices.length;
  }
  const moveOrder = slots.map((slot) =>
    "blank" in slot
      ? appended + slot.blank
      : offsets[slot.batch] + slot.position,
  );
  return {
    batches,
    blanks,
    moveOrder,
    rotations: pages.map((p) => p.rotation),
  };
}
