/**
 * The organized file, described page by page: what the UI sends to the
 * worker to save.
 */
import type { QuarterTurns } from "@/lib/pdfium/page-box";
import { isQuarterTurns } from "@/lib/pdfium/page-box";
import { MAX_BOARD_PAGES, PAGE_SIDE_LIMITS, type BoardPage } from "./board";

/** One page of the output, without UI-only fields (keys). */
export type OutputPage =
  | {
      kind: "source";
      sourceId: string;
      pageIndex: number;
      /** Quarter turns to add to the page's own /Rotate. */
      rotation: QuarterTurns;
    }
  | {
      kind: "blank";
      /** Width in points. */
      width: number;
      /** Height in points. */
      height: number;
      /** Quarter turns for the new page's /Rotate. */
      rotation: QuarterTurns;
    };

/** The output plan is unusable; the message says which page and why. */
export class InvalidOutputPlanError extends Error {
  /** @param message What is wrong with the plan. */
  constructor(message: string) {
    super(message);
    this.name = "InvalidOutputPlanError";
  }
}

/** Longest source id accepted; ids are short strings made by the UI. */
export const MAX_SOURCE_ID_LENGTH = 64;

/**
 * Describe the board as output pages, in board order.
 *
 * @param pages The board pages.
 * @returns The plan the worker saves.
 */
export function buildOutputPlan(pages: readonly BoardPage[]): OutputPage[] {
  return pages.map((page) =>
    page.kind === "source"
      ? {
          kind: "source",
          sourceId: page.sourceId,
          pageIndex: page.pageIndex,
          rotation: page.rotation,
        }
      : {
          kind: "blank",
          width: page.width,
          height: page.height,
          rotation: page.rotation,
        },
  );
}

/**
 * Whether a value is a usable source id.
 *
 * @param value Anything.
 * @returns `true` for a non-empty string of at most
 *   {@link MAX_SOURCE_ID_LENGTH} characters.
 */
export function isSourceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SOURCE_ID_LENGTH
  );
}

/**
 * Check a plan that arrived over `postMessage`, where it could be anything.
 *
 * Unlike the editor's sanitiser, which drops a single bad object, any bad
 * page rejects the whole plan: silently leaving a page out (or adding a
 * wrong one) would produce a file that looks right but is not what the
 * board showed.
 *
 * @param raw The plan as received.
 * @param pageCounts Number of pages of each open file, by source id.
 * @returns A copy holding only the known fields.
 * @throws {InvalidOutputPlanError} When anything is missing, unknown, out of
 *   range or not an integer, or the plan is empty or too long.
 */
export function sanitizeOutputPlan(
  raw: unknown,
  pageCounts: ReadonlyMap<string, number>,
): OutputPage[] {
  if (!Array.isArray(raw))
    throw new InvalidOutputPlanError("the plan is not a list");
  if (raw.length === 0) throw new InvalidOutputPlanError("there are no pages");
  if (raw.length > MAX_BOARD_PAGES) {
    throw new InvalidOutputPlanError(`more than ${MAX_BOARD_PAGES} pages`);
  }
  return raw.map((item: unknown, i): OutputPage => {
    const where = `page ${i + 1}`;
    if (typeof item !== "object" || item === null) {
      throw new InvalidOutputPlanError(`${where} is not described`);
    }
    const page = item as Record<string, unknown>;
    if (!isQuarterTurns(page.rotation)) {
      throw new InvalidOutputPlanError(`${where} has an invalid rotation`);
    }
    if (page.kind === "source") {
      const count = isSourceId(page.sourceId)
        ? pageCounts.get(page.sourceId)
        : undefined;
      if (count === undefined) {
        throw new InvalidOutputPlanError(
          `${where} comes from a file that is not open`,
        );
      }
      const index = page.pageIndex;
      if (
        !Number.isInteger(index) ||
        (index as number) < 0 ||
        (index as number) >= count
      ) {
        throw new InvalidOutputPlanError(`${where} does not exist in its file`);
      }
      return {
        kind: "source",
        sourceId: page.sourceId as string,
        pageIndex: index as number,
        rotation: page.rotation,
      };
    }
    if (page.kind === "blank") {
      const sideOk = (v: unknown) =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        v >= PAGE_SIDE_LIMITS.min &&
        v <= PAGE_SIDE_LIMITS.max;
      if (!sideOk(page.width) || !sideOk(page.height)) {
        throw new InvalidOutputPlanError(`${where} has an invalid size`);
      }
      return {
        kind: "blank",
        width: page.width as number,
        height: page.height as number,
        rotation: page.rotation,
      };
    }
    throw new InvalidOutputPlanError(`${where} has an unknown kind`);
  });
}
