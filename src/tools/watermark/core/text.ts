import { Encodings } from "@pdf-lib/standard-fonts";
import type { WatermarkFont } from "./model";

/**
 * PDF base font names for each family, regular and bold. PDFium's
 * `FPDFPageObj_NewTextObj` and every PDF reader understand these names
 * without any font file (the PDF "standard 14" fonts).
 */
const STANDARD_FONT_NAMES: Record<
  WatermarkFont,
  { regular: string; bold: string }
> = {
  helvetica: { regular: "Helvetica", bold: "Helvetica-Bold" },
  times: { regular: "Times-Roman", bold: "Times-Bold" },
  courier: { regular: "Courier", bold: "Courier-Bold" },
};

/**
 * The standard font to write a watermark in.
 *
 * @param font The family.
 * @param bold Whether to use the bold face.
 * @returns A standard 14 base font name, e.g. "Helvetica-Bold".
 */
export function standardFontName(font: WatermarkFont, bold: boolean): string {
  const names = STANDARD_FONT_NAMES[font];
  return bold ? names.bold : names.regular;
}

/**
 * Clean up typed or pasted watermark text.
 *
 * - Windows (CRLF) and old Mac (CR) line breaks become "\n".
 * - Tabs become one space: the standard fonts have no tab glyph.
 * - Spaces at the end of a line are dropped; they would only widen the
 *   line's box and pull it off centre.
 * - Blank lines before the first and after the last line of text are
 *   dropped, for the same reason. Blank lines in between are kept, since
 *   they are a deliberate gap.
 *
 * @param text Raw text from a text field.
 * @returns The normalised text ("" when nothing visible is left).
 */
export function normalizeWatermarkText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end).join("\n");
}

/**
 * Split normalised text into its lines.
 *
 * @param text Text from {@link normalizeWatermarkText}.
 * @returns The lines, in order (none for empty text).
 */
export function textLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/**
 * Find the characters the standard fonts cannot write.
 *
 * PDFium writes standard-font text in the WinAnsi encoding (ASCII, Latin-1
 * and a few extras such as € and typographic quotes). For a character
 * outside it, PDFium does not fail: it silently writes byte 0xFF, which
 * WinAnsi shows as "ÿ" (checked against the real WebAssembly build). Such
 * text must therefore be refused before it reaches PDFium.
 *
 * Iterating with `for...of` walks code points, so a character outside the
 * Basic Multilingual Plane (an emoji) is checked as one character, not as
 * two surrogate halves.
 *
 * @param text Any text; "\n" is allowed (it separates lines).
 * @returns Each unsupported character once, in order of appearance.
 */
export function unsupportedCharacters(text: string): string[] {
  const found: string[] = [];
  for (const char of text) {
    if (char === "\n" || found.includes(char)) continue;
    const codePoint = char.codePointAt(0)!;
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint))
      found.push(char);
  }
  return found;
}
