/** What PDFium has to do to turn the file's page list into the edited one. */
export interface PageOperations {
  /**
   * Source page indices to delete, highest first. Deleting from the end
   * never shifts the pages still waiting to be deleted.
   */
  deletions: number[];
  /**
   * After the deletions: the current indices of the remaining pages, listed
   * in the desired output order. `null` when they are already in order.
   */
  moveOrder: number[] | null;
}

/**
 * Plan the deletions and the reordering that turn a file's pages into the
 * requested `order`.
 *
 * Worked example: 5 pages, requested order [3, 0, 2] (page 1 and page 4 were
 * deleted, page 3 was moved to the front).
 * 1. Deletions: every index missing from `order`, highest first: [4, 1].
 *    Removing page 4 first leaves page 1 at index 1, so the second deletion
 *    still hits the right page.
 * 2. The survivors keep their original relative order, so a survivor's new
 *    index is its rank among the kept indices. Kept, sorted: [0, 2, 3], so
 *    source 0 -> 0, source 2 -> 1, source 3 -> 2.
 * 3. Translating the requested order through that map gives [2, 0, 1]: "put
 *    what is now page 2 first, then page 0, then page 1". PDFium's
 *    `FPDF_MovePages(doc, [2, 0, 1], 3, 0)` moves exactly those pages, in
 *    that order, to index 0, which produces the requested order.
 * 4. If the translated order is already 0, 1, 2, ... nothing needs moving.
 *
 * @param pageCount Number of pages in the source file.
 * @param order Source indices in output order: unique, in range, non-empty.
 * @returns The deletions and the move order.
 * @throws When `order` breaks those rules (callers validate first; this is a
 *   last line of defence against corrupting the document).
 */
export function planPageOperations(
  pageCount: number,
  order: readonly number[],
): PageOperations {
  const kept = new Set(order);
  const valid =
    order.length > 0 &&
    kept.size === order.length &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < pageCount);
  if (!valid) throw new Error("Invalid page order");

  const deletions: number[] = [];
  for (let i = pageCount - 1; i >= 0; i--) if (!kept.has(i)) deletions.push(i);

  const survivors = [...kept].sort((a, b) => a - b);
  const indexAfterDeletion = new Map(survivors.map((source, i) => [source, i]));
  const moveOrder = order.map((source) => indexAfterDeletion.get(source)!);
  const alreadyOrdered = moveOrder.every((index, i) => index === i);
  return { deletions, moveOrder: alreadyOrdered ? null : moveOrder };
}
