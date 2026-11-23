import { NO_MARGINS, type Margins } from "./margins";
import { allPages, parsePageRange, type PageRangeResult } from "./page-range";

/** Everything the user sets before cropping. */
export interface CropSettings {
  /** What to cut from each displayed edge, in points. */
  margins: Margins;
  /** Crop every page, or the pages in `range`. */
  pages: "all" | "range";
  /** The page range text, e.g. "1-3, 5" (used when `pages` is "range"). */
  range: string;
  /** Delete what lies outside instead of only hiding it. */
  removeOutside: boolean;
}

/**
 * The settings a freshly opened file starts with: no margins, every page,
 * and removing what lies outside (the reason most people crop a PDF they
 * share is that the cut-off part should be gone).
 */
export const DEFAULT_SETTINGS: CropSettings = {
  margins: NO_MARGINS,
  pages: "all",
  range: "",
  removeOutside: true,
};

/**
 * The 0-based pages the settings apply to.
 *
 * @param settings The settings.
 * @param pageCount Pages in the document.
 * @returns The pages, or why the range does not name any.
 */
export function selectedPages(
  settings: CropSettings,
  pageCount: number,
): PageRangeResult {
  return settings.pages === "all"
    ? { ok: true, pages: allPages(pageCount) }
    : parsePageRange(settings.range, pageCount);
}

/**
 * Whether any margin is set (with none, cropping changes nothing).
 *
 * @param margins The margins.
 * @returns True when at least one edge is cut.
 */
export function hasMargins(margins: Margins): boolean {
  return Object.values(margins).some((m) => m > 0);
}
