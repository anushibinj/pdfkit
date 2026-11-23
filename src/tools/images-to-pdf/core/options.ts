/**
 * Page layout options for Images to PDF: paper sizes, orientation, margins,
 * and image scaling modes, plus pure sanitisation for untrusted worker input.
 */

/** Supported paper size choices: "fit" sizes each page to its image. */
export type ImagePageSize = "fit" | "A4" | "Letter" | "Legal";

/** Page orientation when using a fixed paper size (ignored for "fit"). */
export type PageOrientation = "auto" | "portrait" | "landscape";

/** How an image is scaled inside a fixed paper size's printable area. */
export type ImageScaleMode = "contain" | "actual";

/** Complete layout settings controlling how images are placed on PDF pages. */
export interface PageLayoutOptions {
  pageSize: ImagePageSize;
  orientation: PageOrientation;
  /** Margin around the printable area in millimetres (0..50). */
  marginMm: number;
  scaleMode: ImageScaleMode;
}

/** Paper size choices offered in the UI, in display order. */
export const IMAGE_PAGE_SIZES: readonly ImagePageSize[] = [
  "fit",
  "A4",
  "Letter",
  "Legal",
];

/** Orientation choices offered in the UI, in display order. */
export const PAGE_ORIENTATIONS: readonly PageOrientation[] = [
  "auto",
  "portrait",
  "landscape",
];

/** Image scaling choices offered in the UI, in display order. */
export const IMAGE_SCALE_MODES: readonly ImageScaleMode[] = [
  "contain",
  "actual",
];

/** Smallest and largest page margin accepted, in millimetres. */
export const IMAGE_MARGIN_LIMITS_MM = { min: 0, max: 50 } as const;

/**
 * Portrait dimensions (width x height in PDF points, 1 pt = 1/72 inch) for
 * standard fixed paper sizes.
 *
 * - A4:     210 mm x 297 mm -> 595.28 x 841.89 pt
 * - Letter: 8.5 in x 11 in  -> 612 x 792 pt
 * - Legal:  8.5 in x 14 in  -> 612 x 1008 pt
 */
export const FIXED_PAPER_POINTS: Readonly<
  Record<Exclude<ImagePageSize, "fit">, { width: number; height: number }>
> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
};

/** Default layout: A4, auto-orient per image, 10 mm margins, fit inside margins. */
export const DEFAULT_LAYOUT_OPTIONS: PageLayoutOptions = {
  pageSize: "A4",
  orientation: "auto",
  marginMm: 10,
  scaleMode: "contain",
};

/**
 * Type guard verifying whether an unknown value is a valid {@link ImagePageSize}.
 *
 * @param value Untrusted value from a form control or worker message.
 * @returns `true` if `value` is one of {@link IMAGE_PAGE_SIZES}.
 */
export function isImagePageSize(value: unknown): value is ImagePageSize {
  return (
    typeof value === "string" &&
    (IMAGE_PAGE_SIZES as readonly string[]).includes(value)
  );
}

/**
 * Type guard verifying whether an unknown value is a valid {@link PageOrientation}.
 *
 * @param value Untrusted value from a form control or worker message.
 * @returns `true` if `value` is one of {@link PAGE_ORIENTATIONS}.
 */
export function isPageOrientation(value: unknown): value is PageOrientation {
  return (
    typeof value === "string" &&
    (PAGE_ORIENTATIONS as readonly string[]).includes(value)
  );
}

/**
 * Type guard verifying whether an unknown value is a valid {@link ImageScaleMode}.
 *
 * @param value Untrusted value from a form control or worker message.
 * @returns `true` if `value` is one of {@link IMAGE_SCALE_MODES}.
 */
export function isImageScaleMode(value: unknown): value is ImageScaleMode {
  return (
    typeof value === "string" &&
    (IMAGE_SCALE_MODES as readonly string[]).includes(value)
  );
}

/**
 * Sanitise partial or untrusted layout options into safe, bounded values.
 *
 * The worker never trusts incoming messages verbatim:
 * - Unknown enum values fall back to {@link DEFAULT_LAYOUT_OPTIONS}.
 * - Non-finite margins (`NaN` while clearing a number input, `Infinity`,
 *   non-numbers) fall back to the default margin.
 * - Finite margins are clamped to {@link IMAGE_MARGIN_LIMITS_MM} so an extreme
 *   margin can never collapse the printable area to zero or negative size.
 *
 * @param input Partial or untrusted options object.
 * @returns Complete, valid {@link PageLayoutOptions}.
 */
export function normalizeLayoutOptions(
  input: Partial<PageLayoutOptions> | undefined,
): PageLayoutOptions {
  const pageSize = isImagePageSize(input?.pageSize)
    ? input.pageSize
    : DEFAULT_LAYOUT_OPTIONS.pageSize;
  const orientation = isPageOrientation(input?.orientation)
    ? input.orientation
    : DEFAULT_LAYOUT_OPTIONS.orientation;
  const scaleMode = isImageScaleMode(input?.scaleMode)
    ? input.scaleMode
    : DEFAULT_LAYOUT_OPTIONS.scaleMode;

  const rawMargin = input?.marginMm;
  const marginMm =
    typeof rawMargin === "number" && Number.isFinite(rawMargin)
      ? Math.min(
          IMAGE_MARGIN_LIMITS_MM.max,
          Math.max(IMAGE_MARGIN_LIMITS_MM.min, rawMargin),
        )
      : DEFAULT_LAYOUT_OPTIONS.marginMm;

  return { pageSize, orientation, marginMm, scaleMode };
}
