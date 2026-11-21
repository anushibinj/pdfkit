/** An sRGB colour with 8-bit channels (0-255). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a `#rrggbb` colour, the format `<input type="color">` produces.
 *
 * @param hex A hex colour such as "#1d4ed8" (case-insensitive).
 * @returns The colour, or `null` when the text is not `#` plus six hex digits.
 */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

/**
 * Format a colour as lowercase `#rrggbb` (for colour inputs and SVG fills).
 * Channels are clamped and rounded first, so slightly-off values still give
 * a valid colour.
 *
 * @param rgb A colour.
 * @returns The hex text.
 */
export function rgbToHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((c) => clampChannel(c).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Force a channel value into 0..255 as an integer.
 *
 * @param value Any number (NaN counts as 0).
 * @returns The nearest valid channel value.
 */
export function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}
