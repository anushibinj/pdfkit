/**
 * The page organizer's data model: plain, JSON-serialisable types shared by
 * the UI, the pure core and (through the save plan) the worker.
 *
 * Two kinds of state are kept apart on purpose:
 * - **Sources** are the opened PDF files. They are not undoable: undoing
 *   "add file" removes its pages from the board, but the file stays open so
 *   redo can bring the pages back without reading the file again.
 * - **Board pages** are the output, in order. This list is what undo and
 *   redo step through.
 */
import type { PageInfo, QuarterTurns } from "@/tools/edit/core/model";
import { addTurns, viewSize, type Size } from "@/tools/edit/core/page-geometry";

/** A page of one of the opened files, placed on the board. */
export interface SourcePage {
  kind: "source";
  /** Unique on the board and stable while the page moves (React key). */
  key: string;
  /** The opened file the page comes from. */
  sourceId: string;
  /** Zero-based index of the page in that file. */
  pageIndex: number;
  /** Clockwise quarter turns the user added on top of the page's /Rotate. */
  rotation: QuarterTurns;
}

/** An empty page the user inserted. */
export interface BlankPage {
  kind: "blank";
  /** Unique on the board and stable while the page moves (React key). */
  key: string;
  /** Width in points before `rotation` is applied. */
  width: number;
  /** Height in points before `rotation` is applied. */
  height: number;
  /** Clockwise quarter turns the user added. */
  rotation: QuarterTurns;
}

/** One page of the output, in board order. */
export type BoardPage = SourcePage | BlankPage;

/** An opened PDF file. */
export interface BoardSource {
  /** Unique id, also used by the worker to find the open document. */
  id: string;
  /** The file name, for display and for naming the download. */
  name: string;
  /** Each page's box and own /Rotate, by page index. */
  pages: readonly PageInfo[];
  /** Slot in the colour palette (see `source-colors.ts`). */
  colorIndex: number;
  /**
   * The file needed a password to open. The organized file is a new
   * document and is saved without one, which the UI points out.
   */
  passwordProtected: boolean;
}

/** Sources by id, as the core looks them up. */
export type SourceMap = ReadonlyMap<string, BoardSource>;

/** Size of a new blank page when there is no neighbour to copy: A4 portrait. */
export const A4: Size = { width: 595.28, height: 841.89 };

/**
 * PDF's implementation limit for a page side is 14,400 user units (200
 * inches); readers are allowed to refuse anything larger. 3 is the matching
 * lower limit.
 */
export const PAGE_SIDE_LIMITS = { min: 3, max: 14_400 } as const;

/** Most pages the board holds; beyond this the browser tab gets sluggish. */
export const MAX_BOARD_PAGES = 5000;

/**
 * Index the sources by id.
 *
 * @param sources The opened files.
 * @returns A map from id to source.
 */
export function sourceMap(sources: readonly BoardSource[]): SourceMap {
  return new Map(sources.map((s) => [s.id, s]));
}

/**
 * Create the board pages for every page of a newly opened file, in file
 * order and unrotated.
 *
 * @param sourceId The file's id.
 * @param pageCount Its number of pages.
 * @param makeKey Returns a fresh, unique key on each call.
 * @returns One board page per file page.
 */
export function pagesOfSource(
  sourceId: string,
  pageCount: number,
  makeKey: () => string,
): SourcePage[] {
  return Array.from({ length: pageCount }, (_, pageIndex) => ({
    kind: "source",
    key: makeKey(),
    sourceId,
    pageIndex,
    rotation: 0,
  }));
}

/**
 * The size of a board page as it is shown, and as it will appear in the
 * saved file.
 *
 * For a page of a file that is its visible box turned by its own /Rotate
 * plus the user's turns (an odd total lays it on its side and swaps width
 * and height). A blank page has no /Rotate of its own, only the user's.
 *
 * @param page The board page.
 * @param sources The opened files.
 * @returns Width and height in points, or `null` when the page refers to a
 *   file or page that does not exist (which would be a bug).
 */
export function displayedSize(
  page: BoardPage,
  sources: SourceMap,
): Size | null {
  if (page.kind === "blank") {
    const box = { left: 0, bottom: 0, right: page.width, top: page.height };
    return viewSize(box, page.rotation);
  }
  const info = sources.get(page.sourceId)?.pages[page.pageIndex];
  if (!info) return null;
  return viewSize(info.box, addTurns(info.rotation, page.rotation));
}

/**
 * Whether a displayed page is wider than it is tall. A square page is not
 * landscape (turning it would change nothing).
 *
 * @param size The displayed size.
 * @returns `true` for landscape.
 */
export function isLandscape(size: Size): boolean {
  return size.width > size.height;
}

/**
 * Keep a page side inside {@link PAGE_SIDE_LIMITS}. Non-finite input (which
 * only a corrupt page box could produce) falls back to the A4 side given.
 *
 * @param value A side length in points.
 * @param fallback The value to use when `value` is not a finite number.
 * @returns A side PDF readers accept.
 */
export function clampPageSide(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(PAGE_SIDE_LIMITS.max, Math.max(PAGE_SIDE_LIMITS.min, value));
}
