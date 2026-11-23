import { expandPageRuns, parsePageRuns } from "@/lib/page-ranges";
import type { PageSelection } from "./page-selection";

/** What the tool makes from the PDF. */
export type ToolMode = "split" | "extract" | "remove";

/** How "split" cuts the PDF. */
export type SplitMethod = "every" | "ranges";

/** One file to produce. */
export interface PlannedOutput {
  /** Source page indices (0-based) in output order. Never empty. */
  pages: number[];
}

/** The files to produce, or why the current settings cannot produce any. */
export type PlanResult =
  | { ok: true; outputs: PlannedOutput[] }
  | { ok: false; error: string };

/** Everything the person has set, for whichever mode is active. */
export interface PlanSettings {
  mode: ToolMode;
  pageCount: number;
  /** Split: cut every N pages or by typed ranges. */
  splitMethod: SplitMethod;
  /** Split every N pages: N, as typed (may be anything). */
  everyN: number;
  /** Split by ranges: the typed list, one file per item. */
  rangesText: string;
  /** Extract and remove: the picked pages. */
  selection: PageSelection;
}

/** Turns the settings into files (one strategy per mode). */
export type Planner = (settings: PlanSettings) => PlanResult;

/**
 * Split into files of `size` pages each; the last file takes what is left.
 *
 * @param pageCount Pages in the document.
 * @param size Pages per file, as entered.
 * @returns One output per chunk, or why it cannot be done.
 */
export function planEvery(pageCount: number, size: number): PlanResult {
  if (pageCount < 2) {
    return { ok: false, error: "This PDF has only one page, so there is nothing to split." };
  }
  if (!Number.isInteger(size) || size < 1) {
    return { ok: false, error: "Enter a whole number of pages per file, 1 or more." };
  }
  if (size >= pageCount) {
    return {
      ok: false,
      error: `Each file would hold all ${pageCount} pages. Enter a number below ${pageCount}.`,
    };
  }
  const outputs: PlannedOutput[] = [];
  for (let first = 0; first < pageCount; first += size) {
    const last = Math.min(first + size, pageCount) - 1;
    outputs.push({ pages: range(first, last) });
  }
  return { ok: true, outputs };
}

/**
 * Split by typed ranges: each comma-separated item becomes its own file
 * ("1-3, 4-8, 9-" makes three files). Overlapping or repeated ranges are
 * allowed; each simply makes its own file.
 *
 * @param text The typed list.
 * @param pageCount Pages in the document.
 * @returns One output per item, or why the text cannot be used.
 */
export function planRanges(text: string, pageCount: number): PlanResult {
  const parsed = parsePageRuns(text, pageCount);
  if (!parsed.ok) return parsed;
  if (parsed.runs.length === 0) {
    return { ok: false, error: "Enter at least one range, for example 1-3, 4-8." };
  }
  return {
    ok: true,
    outputs: parsed.runs.map((run) => ({ pages: expandPageRuns([run]) })),
  };
}

/**
 * Extract: one file with the picked pages, in page order.
 *
 * @param selection The picked pages.
 * @returns One output, or why there is nothing to extract.
 */
export function planExtract(selection: PageSelection): PlanResult {
  if (selection.error) return { ok: false, error: selection.error };
  if (selection.pages.size === 0) {
    return { ok: false, error: "Pick at least one page to extract." };
  }
  return { ok: true, outputs: [{ pages: sorted(selection.pages) }] };
}

/**
 * Remove: one file with every page that was not picked, in page order.
 *
 * @param selection The pages to remove.
 * @param pageCount Pages in the document.
 * @returns One output, or why the pages cannot be removed.
 */
export function planRemove(
  selection: PageSelection,
  pageCount: number,
): PlanResult {
  if (selection.error) return { ok: false, error: selection.error };
  if (selection.pages.size === 0) {
    return { ok: false, error: "Pick at least one page to remove." };
  }
  const kept = range(0, pageCount - 1).filter((p) => !selection.pages.has(p));
  if (kept.length === 0) {
    return { ok: false, error: "A PDF needs at least one page. Leave at least one unpicked." };
  }
  return { ok: true, outputs: [{ pages: kept }] };
}

/**
 * The strategy for each mode. Adding a mode means adding an entry here and
 * nothing else in this module.
 */
export const PLANNERS: Readonly<Record<ToolMode, Planner>> = {
  split: (s) =>
    s.splitMethod === "every"
      ? planEvery(s.pageCount, s.everyN)
      : planRanges(s.rangesText, s.pageCount),
  extract: (s) => planExtract(s.selection),
  remove: (s) => planRemove(s.selection, s.pageCount),
};

/**
 * Work out the files the current settings produce.
 *
 * @param settings Everything the person has set.
 * @returns The outputs, or a message for the person.
 */
export function planOutputs(settings: PlanSettings): PlanResult {
  return PLANNERS[settings.mode](settings);
}

/**
 * @param first First index.
 * @param last Last index (included).
 * @returns `[first, first + 1, ..., last]` (empty when last < first).
 */
function range(first: number, last: number): number[] {
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

/**
 * @param pages A set of page indices.
 * @returns The indices in ascending order.
 */
function sorted(pages: ReadonlySet<number>): number[] {
  return [...pages].sort((a, b) => a - b);
}
