/**
 * Pure operations on the board's page list.
 *
 * Every function takes the list and returns a new one, and returns the
 * **same array object** when the operation would change nothing (moving a
 * page to where it already is, rotating zero pages, deleting every page).
 * The undo history relies on that identity to skip empty undo steps.
 *
 * Pages are identified by their `key`, never by position, because a
 * position changes as soon as anything before it moves.
 */
import type { QuarterTurns } from "@/tools/edit/core/model";
import { addTurns, type Size } from "@/tools/edit/core/page-geometry";
import { isLandscape, type BoardPage } from "./board";

/** Anything with a stable key; the reordering functions need nothing more. */
export interface Keyed {
  key: string;
}

/**
 * Whether two lists hold the same objects in the same order.
 *
 * @param a A list.
 * @param b Another list.
 * @returns `true` when they are element-wise identical.
 */
export function sameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Move the pages with `keys` so they sit together at gap `gap`.
 *
 * A gap is a position *between* pages, as the drop indicator shows it: gap
 * 0 is before the first page, gap `n` after the last. The moved pages keep
 * their relative order and are inserted as one block.
 *
 * Worked example: pages [A, B, C, D, E], move {B, D} to gap 4 (between D
 * and E).
 * 1. Split: moving = [B, D], rest = [A, C, E].
 * 2. The gap counts positions in the *original* list. The block must land
 *    after every remaining page that was before gap 4, i.e. after A and C
 *    (B and D are being moved, so they do not count): insertion point 2 in
 *    `rest`.
 * 3. Result: [A, C] + [B, D] + [E] = [A, C, B, D, E].
 *
 * @param pages The board pages.
 * @param keys Keys of the pages to move (unknown keys are ignored).
 * @param gap Target gap, 0..pages.length (clamped).
 * @returns The reordered list, or `pages` itself when nothing moved.
 */
export function moveKeysTo<T extends Keyed>(
  pages: readonly T[],
  keys: ReadonlySet<string>,
  gap: number,
): readonly T[] {
  const target = Math.min(pages.length, Math.max(0, Math.trunc(gap) || 0));
  const moving: T[] = [];
  const rest: T[] = [];
  let insertAt = 0;
  pages.forEach((page, index) => {
    if (keys.has(page.key)) {
      moving.push(page);
    } else {
      // A remaining page before the gap pushes the insertion point right.
      if (index < target) insertAt++;
      rest.push(page);
    }
  });
  if (moving.length === 0) return pages;
  const next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  return sameOrder(next, pages) ? pages : next;
}

/**
 * Move the pages with `keys` by `delta` places, as one block (the keyboard
 * move shortcut and the "Move earlier/later" buttons).
 *
 * The block's position is counted among the pages that are *not* moving:
 * its first page currently has `p` of them before it, and afterwards it has
 * `p + delta` (clamped to the ends). For a contiguous selection that moves
 * it by exactly `delta` places. A scattered selection is gathered at its
 * first page and then moved, which is also what dragging it does.
 *
 * Worked example: [A, B, C, D, E], move {B, C} by +1. Remaining: [A, D, E];
 * B has 1 remaining page (A) before it, so the block goes after 2: [A, D]
 * + [B, C] + [E] = [A, D, B, C, E].
 *
 * @param pages The board pages.
 * @param keys Keys of the pages to move.
 * @param delta Places to move: negative is earlier, positive is later.
 * @returns The reordered list, or `pages` itself when nothing moved.
 */
export function moveKeysBy<T extends Keyed>(
  pages: readonly T[],
  keys: ReadonlySet<string>,
  delta: number,
): readonly T[] {
  const first = pages.findIndex((p) => keys.has(p.key));
  if (first < 0) return pages;
  const restBefore = pages
    .slice(0, first)
    .filter((p) => !keys.has(p.key)).length;
  const restCount = pages.filter((p) => !keys.has(p.key)).length;
  const position = Math.min(restCount, Math.max(0, restBefore + delta));
  // Translate "after `position` remaining pages" back into a gap of the
  // full list for moveKeysTo: walk until that many remaining pages passed.
  let gap = 0;
  let passed = 0;
  while (gap < pages.length && passed < position) {
    if (!keys.has(pages[gap].key)) passed++;
    gap++;
  }
  return moveKeysTo(pages, keys, gap);
}

/**
 * Turn the pages with `keys` by `delta` clockwise quarter turns.
 *
 * @param pages The board pages.
 * @param keys Keys of the pages to turn.
 * @param delta Quarter turns; negative turns anticlockwise.
 * @returns The new list, or `pages` itself when no page turned.
 */
export function rotateKeys(
  pages: readonly BoardPage[],
  keys: ReadonlySet<string>,
  delta: number,
): readonly BoardPage[] {
  if (addTurns(0, delta) === 0) return pages;
  let changed = false;
  const next = pages.map((page) => {
    if (!keys.has(page.key)) return page;
    changed = true;
    return { ...page, rotation: addTurns(page.rotation, delta) };
  });
  return changed ? next : pages;
}

/**
 * Remove the pages with `keys`.
 *
 * Removing every page is refused (a PDF needs at least one page, and an
 * empty board would have nothing to download), so is removing none.
 *
 * @param pages The board pages.
 * @param keys Keys of the pages to remove.
 * @returns The remaining pages, or `pages` itself when refused.
 */
export function removeKeys<T extends Keyed>(
  pages: readonly T[],
  keys: ReadonlySet<string>,
): readonly T[] {
  const next = pages.filter((p) => !keys.has(p.key));
  if (next.length === pages.length || next.length === 0) return pages;
  return next;
}

/**
 * Put a copy of each page with `keys` directly after the page itself.
 *
 * A copy has the original's content and rotation and a new key, so the two
 * can be moved, turned and deleted independently.
 *
 * @param pages The board pages.
 * @param keys Keys of the pages to copy.
 * @param makeKey Returns a fresh, unique key on each call.
 * @returns The new list and the copies' keys, in board order (`pages`
 *   itself and no keys when nothing matched).
 */
export function duplicateKeys<T extends Keyed>(
  pages: readonly T[],
  keys: ReadonlySet<string>,
  makeKey: () => string,
): { pages: readonly T[]; created: string[] } {
  const created: string[] = [];
  const next: T[] = [];
  for (const page of pages) {
    next.push(page);
    if (keys.has(page.key)) {
      const key = makeKey();
      created.push(key);
      next.push({ ...page, key });
    }
  }
  return created.length === 0 ? { pages, created } : { pages: next, created };
}

/**
 * Insert one page at a gap.
 *
 * @param pages The board pages.
 * @param gap Where to insert, 0..pages.length (clamped).
 * @param page The page to insert.
 * @returns The new list.
 */
export function insertAt<T>(
  pages: readonly T[],
  gap: number,
  page: T,
): readonly T[] {
  const at = Math.min(pages.length, Math.max(0, Math.trunc(gap) || 0));
  return [...pages.slice(0, at), page, ...pages.slice(at)];
}

/**
 * Reorder some pages among the positions they already occupy, leaving every
 * other page where it is.
 *
 * Example: [A, x, B, y, C] with scope {A, B, C} and `reverseOrder` gives
 * [C, x, B, y, A]: the slots 0, 2 and 4 are refilled with the scope's pages
 * in their new order, x and y do not move.
 *
 * This is what makes "Interleave selected" and "Reverse selected" safe on a
 * scattered selection, and with every page in scope it simply reorders the
 * whole board.
 *
 * @param pages The board pages.
 * @param keys Keys of the pages to reorder (the scope).
 * @param permute Returns the scope's pages in their new order. It must
 *   return the same pages it was given (any order), no more and no fewer.
 * @returns The new list, or `pages` itself when the order did not change.
 * @throws When `permute` adds, drops or replaces pages (a programming error).
 */
export function permuteSlots<T extends Keyed>(
  pages: readonly T[],
  keys: ReadonlySet<string>,
  permute: (scope: readonly T[]) => readonly T[],
): readonly T[] {
  const slots: number[] = [];
  const scope: T[] = [];
  pages.forEach((page, index) => {
    if (keys.has(page.key)) {
      slots.push(index);
      scope.push(page);
    }
  });
  const reordered = permute(scope);
  const sameMembers =
    reordered.length === scope.length &&
    new Set(reordered).size === scope.length &&
    reordered.every((page) => scope.includes(page));
  if (!sameMembers) throw new Error("A page permutation must keep every page");
  if (sameOrder(reordered, scope)) return pages;
  const next = [...pages];
  slots.forEach((slot, i) => {
    next[slot] = reordered[i];
  });
  return next;
}

/**
 * Restore the page order of a double-sided paper stack scanned on a
 * single-sided feeder.
 *
 * Scanning the stack once gives the fronts in order (1, 3, 5, ...).
 * Turning the stack over and scanning again gives the backs, but last page
 * first (..., 6, 4, 2). So the input is "fronts, then reversed backs":
 *
 *   input:  F1 F2 F3 F4 F5 B5 B4 B3 B2 B1    (pages 1 3 5 7 9 10 8 6 4 2)
 *   output: F1 B1 F2 B2 F3 B3 F4 B4 F5 B5    (pages 1 2 3 ... 10)
 *
 * Steps: the first ceil(n/2) items are the fronts; the rest, reversed, are
 * the backs; then take one of each in turn. With an odd count (the last
 * sheet's back was blank and removed) the extra front goes last.
 *
 * @param items The pages in scanned order.
 * @returns The pages in reading order.
 */
export function interleaveOrder<T>(items: readonly T[]): T[] {
  const frontCount = Math.ceil(items.length / 2);
  const fronts = items.slice(0, frontCount);
  const backs = items.slice(frontCount).reverse();
  const out: T[] = [];
  fronts.forEach((front, i) => {
    out.push(front);
    if (i < backs.length) out.push(backs[i]);
  });
  return out;
}

/**
 * Reverse a list (as a new array).
 *
 * @param items The pages.
 * @returns The pages, last first.
 */
export function reverseOrder<T>(items: readonly T[]): T[] {
  return [...items].reverse();
}

/**
 * Turn every landscape page among `keys` a quarter turn clockwise, so that
 * it stands upright (portrait). Portrait and square pages are left alone.
 *
 * Only the page's /Rotate changes (see the save step), so the content is
 * not re-drawn and text stays text.
 *
 * @param pages The board pages.
 * @param keys Keys of the pages to consider.
 * @param sizeOf The displayed size of a page (`null` if unknown: skipped).
 * @returns The new list, or `pages` itself when no page was landscape.
 */
export function turnLandscapeUpright(
  pages: readonly BoardPage[],
  keys: ReadonlySet<string>,
  sizeOf: (page: BoardPage) => Size | null,
): readonly BoardPage[] {
  const turn = new Set<string>();
  for (const page of pages) {
    if (!keys.has(page.key)) continue;
    const size = sizeOf(page);
    if (size && isLandscape(size)) turn.add(page.key);
  }
  return turn.size === 0 ? pages : rotateKeys(pages, turn, 1);
}

/** Quarter-turn values in display order, for labels. */
export const TURN_DEGREES: Record<QuarterTurns, number> = {
  0: 0,
  1: 90,
  2: 180,
  3: 270,
};
