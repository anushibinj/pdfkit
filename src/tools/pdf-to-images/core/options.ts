/**
 * How pages are turned into images: format, resolution and JPEG quality.
 * Pure.
 */

/** Image format of rendered pages. */
export type PageImageFormat = "png" | "jpeg";

/** The user's choices for rendering pages. */
export interface PageRenderOptions {
  format: PageImageFormat;
  /** Dots per inch: pixels for every 72 points of the page. */
  dpi: number;
  /** JPEG quality from 0 to 1 (ignored for PNG). */
  quality: number;
}

/** Resolutions offered in the UI: screen, standard, print, high. */
export const DPI_PRESETS = [72, 150, 300, 600] as const;
/** Lowest and highest resolution the worker accepts. */
export const MIN_DPI = 36;
export const MAX_DPI = 1200;
/** Lowest JPEG quality accepted; below it the artefacts are severe. */
export const MIN_QUALITY = 0.1;

export const DEFAULT_RENDER_OPTIONS: PageRenderOptions = {
  format: "png",
  dpi: 150,
  quality: 0.9,
};

/**
 * Clamp a number into a range, falling back for anything that is not a
 * finite number.
 *
 * @param value Untrusted input.
 * @param min Lowest allowed value.
 * @param max Highest allowed value.
 * @param fallback Used when `value` is not a finite number.
 * @returns A number within [min, max].
 */
export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Make render options safe to use, whatever a message carried.
 *
 * A worker message can contain anything, so each field is checked: an
 * unknown format becomes PNG, the resolution is rounded and clamped to
 * [{@link MIN_DPI}, {@link MAX_DPI}], the quality to [{@link MIN_QUALITY}, 1].
 * Missing or invalid values fall back to {@link DEFAULT_RENDER_OPTIONS}.
 *
 * @param raw Options from a message.
 * @returns Valid options.
 */
export function sanitizeRenderOptions(raw: unknown): PageRenderOptions {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    format: input.format === "jpeg" ? "jpeg" : "png",
    dpi: Math.round(
      clampNumber(input.dpi, MIN_DPI, MAX_DPI, DEFAULT_RENDER_OPTIONS.dpi),
    ),
    quality: clampNumber(
      input.quality,
      MIN_QUALITY,
      1,
      DEFAULT_RENDER_OPTIONS.quality,
    ),
  };
}
