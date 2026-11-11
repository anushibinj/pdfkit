import type { PageSetup, PageSizeName } from "../messages";

/** Paper sizes offered in the UI, in display order. */
export const PAGE_SIZES: readonly PageSizeName[] = ["A4", "Letter", "Legal"];

/** Smallest and largest margin the UI accepts, in millimetres. */
export const MARGIN_LIMITS_MM = { min: 0, max: 50 } as const;

/** A4 with 20 mm margins: a common default for printed documents. */
export const DEFAULT_PAGE_SETUP: PageSetup = { size: "A4", marginMm: 20 };

/** PDF user space unit: 1 point = 1/72 inch, and 1 inch = 25.4 mm. */
const POINTS_PER_MM = 72 / 25.4;

/**
 * Convert millimetres to PDF points.
 *
 * @param mm A length in millimetres.
 * @returns The same length in points (1/72 inch), e.g. 25.4 mm -> 72 pt.
 */
export function mmToPoints(mm: number): number {
  return mm * POINTS_PER_MM;
}

/**
 * Type guard for page size names coming from untyped input (a `<select>`
 * value, a message from another thread).
 *
 * @param value Anything.
 * @returns `true` when `value` is one of {@link PAGE_SIZES}.
 */
export function isPageSizeName(value: unknown): value is PageSizeName {
  return (
    typeof value === "string" &&
    (PAGE_SIZES as readonly string[]).includes(value)
  );
}

/**
 * Turn possibly invalid page settings into safe ones.
 *
 * The worker must never trust its input, because a message can carry anything:
 * - an unknown paper size falls back to the default size;
 * - a margin that is not a finite number (NaN from an empty number field,
 *   `Infinity`, a string) falls back to the default margin;
 * - a finite margin is clamped into {@link MARGIN_LIMITS_MM}, so a typo such as
 *   500 mm cannot leave a zero-width content area that the layout engine
 *   could not fill.
 *
 * @param input Partial or untrusted settings.
 * @returns A complete, valid {@link PageSetup}.
 */
export function normalizePageSetup(
  input: Partial<PageSetup> | undefined,
): PageSetup {
  const size = isPageSizeName(input?.size)
    ? input.size
    : DEFAULT_PAGE_SETUP.size;
  const raw = input?.marginMm;
  const marginMm =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(MARGIN_LIMITS_MM.max, Math.max(MARGIN_LIMITS_MM.min, raw))
      : DEFAULT_PAGE_SETUP.marginMm;
  return { size, marginMm };
}
