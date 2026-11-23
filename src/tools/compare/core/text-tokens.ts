/**
 * Word tokenization over PDFium character streams (`CharWithBox[]`).
 */
import type { PageBox } from "@/lib/pdfium/page-box";
import type { CharWithBox, WordToken } from "./model";

/** Matches Unicode letters or digits (single character test). */
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/** Characters allowed inside a compound word/number (e.g. `1,250.50`, `don't`, `e-mail`). */
const INTERNAL_JOINER_RE = /[.,''’-]/;

/** Whitespace characters including CR/LF and non-breaking spaces. */
const WHITESPACE_RE = /\s/u;

/**
 * Normalise a token string for comparison (collapsing smart apostrophes/dashes
 * to ASCII equivalents so typography tweaks do not cause noisy diffs).
 *
 * @param text Raw token text.
 * @returns Normalised string for diffing and similarity scoring.
 */
export function normalizeTokenText(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");
}

/**
 * Flush the accumulated word buffer into `tokens` and reset it.
 *
 * @param chars Accumulated characters in the current token.
 * @param boxes Accumulated user-space boxes in the current token.
 * @param tokens Destination token array.
 */
function flushToken(
  chars: string[],
  boxes: PageBox[],
  tokens: WordToken[],
): void {
  if (chars.length === 0) return;
  const text = chars.join("");
  tokens.push({
    text,
    normalizedText: normalizeTokenText(text),
    boxes: [...boxes],
  });
  chars.length = 0;
  boxes.length = 0;
}

/**
 * Tokenise a reading-order sequence of PDF characters into word and punctuation
 * tokens, retaining each token's user-space character boxes and building a
 * clean reading-order text string.
 *
 * @param chars Characters from a PDF page in reading order.
 * @returns Clean text string and word tokens with exact user-space boxes.
 */
export function tokenizePageChars(chars: readonly CharWithBox[]): {
  text: string;
  tokens: WordToken[];
} {
  const tokens: WordToken[] = [];
  const wordChars: string[] = [];
  const wordBoxes: PageBox[] = [];

  for (let i = 0; i < chars.length; i++) {
    const entry = chars[i];
    const ch = entry.char;
    if (!ch || WHITESPACE_RE.test(ch)) {
      flushToken(wordChars, wordBoxes, tokens);
      continue;
    }

    if (WORD_CHAR_RE.test(ch)) {
      wordChars.push(ch);
      if (entry.box) wordBoxes.push(entry.box);
      continue;
    }

    const next = chars[i + 1]?.char ?? "";
    if (
      wordChars.length > 0 &&
      INTERNAL_JOINER_RE.test(ch) &&
      WORD_CHAR_RE.test(next)
    ) {
      wordChars.push(ch);
      if (entry.box) wordBoxes.push(entry.box);
      continue;
    }

    flushToken(wordChars, wordBoxes, tokens);
    tokens.push({
      text: ch,
      normalizedText: normalizeTokenText(ch),
      boxes: entry.box ? [entry.box] : [],
    });
  }

  flushToken(wordChars, wordBoxes, tokens);
  const text = tokens.map((t) => t.text).join(" ");
  return { text, tokens };
}
