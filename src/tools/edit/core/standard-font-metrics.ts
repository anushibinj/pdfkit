import { Encodings, Font } from "@pdf-lib/standard-fonts";
import type { FontFamily } from "./model";
import type { FontMetrics, FontMetricsSource } from "./text-layout";

/**
 * PDF base font for each family. These names are understood both by PDFium's
 * `FPDFPageObj_NewTextObj` and by every PDF reader (standard 14 fonts).
 */
export const STANDARD_FONT_NAME: Record<FontFamily, string> = {
  sans: "Helvetica",
  serif: "Times-Roman",
  mono: "Courier",
};

/**
 * Build metrics for one standard font from Adobe's published AFM data
 * (bundled by `@pdf-lib/standard-fonts`).
 *
 * A character is writable when the WinAnsi encoding (the encoding PDFium uses
 * for standard fonts) has a code for it; its width is then the width of the
 * glyph that code names. WinAnsi covers ASCII, Latin-1 and a few extras such
 * as the euro sign and typographic quotes.
 *
 * @param fontName A standard font name, e.g. "Helvetica".
 * @returns The font's metrics.
 */
export function loadStandardFontMetrics(fontName: string): FontMetrics {
  const font = Font.load(fontName as Parameters<typeof Font.load>[0]);
  const winAnsi = Encodings.WinAnsi;
  return {
    ascent: Number(font.Ascender ?? 0),
    descent: Number(font.Descender ?? 0),
    advance(char) {
      const codePoint = char.codePointAt(0);
      if (
        codePoint === undefined ||
        !winAnsi.canEncodeUnicodeCodePoint(codePoint)
      )
        return undefined;
      const { name } = winAnsi.encodeUnicodeCodePoint(codePoint);
      const width = font.getWidthOfGlyph(name);
      return typeof width === "number" ? width : undefined;
    },
  };
}

/**
 * {@link FontMetricsSource} for the three standard font families. Metrics
 * are decompressed on first use of a family and then cached.
 */
export class StandardFontMetricsSource implements FontMetricsSource {
  private readonly cache = new Map<FontFamily, FontMetrics>();

  /**
   * @param font A font family.
   * @returns Its metrics (cached after the first call).
   */
  metrics(font: FontFamily): FontMetrics {
    let found = this.cache.get(font);
    if (!found) {
      found = loadStandardFontMetrics(STANDARD_FONT_NAME[font]);
      this.cache.set(font, found);
    }
    return found;
  }
}
