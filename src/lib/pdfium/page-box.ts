/**
 * Page geometry types shared by every tool that opens PDFs with PDFium.
 *
 * Plain, JSON-serialisable data, so a page's size can cross the worker
 * boundary as-is.
 */

/** A number of 90 degree turns. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * The page's visible area in user space (PDFium's page bounding box: the
 * CropBox clipped to the MediaBox). It does not have to start at (0, 0).
 */
export interface PageBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** What a worker reports about one page of an opened file. */
export interface PageInfo {
  box: PageBox;
  /** The page's own /Rotate, as clockwise quarter turns. */
  rotation: QuarterTurns;
}

/**
 * Type guard for quarter-turn counts coming from untyped input.
 *
 * @param value Anything.
 * @returns `true` for the integers 0, 1, 2 and 3.
 */
export function isQuarterTurns(value: unknown): value is QuarterTurns {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
