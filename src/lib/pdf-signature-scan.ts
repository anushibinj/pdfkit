/**
 * Find digital signatures in a PDF's raw bytes, without parsing the PDF and
 * without any cryptography library. Shared by the Signature Verifier (which
 * then checks each signature) and Protect PDF (which warns that encrypting
 * rewrites the file and so invalidates its signatures).
 */

/** One signature, located by its byte range. */
export interface FoundSignature {
  /** [start1, len1, start2, len2] as written in the PDF */
  byteRange: [number, number, number, number];
  /** DER-ish bytes of the signature container (may have trailing zero padding) */
  contents: Uint8Array;
}

const BYTE_RANGE = new TextEncoder().encode("/ByteRange");

/**
 * Find the first occurrence of `needle` in `hay`, like `String#indexOf` for
 * bytes.
 *
 * @param hay The bytes to search.
 * @param needle The bytes to find.
 * @param from Index to start searching at.
 * @returns The index of the first match at or after `from`, or -1.
 */
export function indexOfBytes(
  hay: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Decode a PDF hex string's digits (whitespace allowed, as in the PDF syntax).
 *
 * @param hex The characters between `<` and `>`.
 * @returns The bytes, or `null` for an odd number of digits or a non-hex
 *   character.
 */
export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Find every signature by scanning for `/ByteRange [a b c d]`. Signature
 * dictionaries must be stored uncompressed (the signed bytes are the file
 * bytes), so a byte scan is reliable and avoids a full PDF parse. The hex
 * `/Contents <...>` string is exactly the gap between the two ranges.
 *
 * A candidate is skipped (and counted) unless: the four numbers parse, the
 * first range starts at 0, the ranges are ordered and inside the file, and
 * the gap between them is a non-empty, valid `<hex>` string.
 *
 * @param pdf The PDF's bytes.
 * @returns The signatures found, and how many candidates were skipped.
 */
export function findSignatures(pdf: Uint8Array): {
  found: FoundSignature[];
  skipped: number;
} {
  const found: FoundSignature[] = [];
  let skipped = 0;
  let pos = 0;
  for (;;) {
    const at = indexOfBytes(pdf, BYTE_RANGE, pos);
    if (at < 0) break;
    pos = at + BYTE_RANGE.length;
    const window = new TextDecoder("latin1").decode(
      pdf.subarray(pos, Math.min(pos + 120, pdf.length)),
    );
    const m = /^\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(window);
    if (!m) {
      skipped++;
      continue;
    }
    const [a, b, c, d] = m.slice(1).map(Number);
    // Gap must be a hex string <...>, within the file, ranges ordered.
    if (a !== 0 || a + b >= c || c + d > pdf.length) {
      skipped++;
      continue;
    }
    const gapStart = a + b;
    if (pdf[gapStart] !== 0x3c || pdf[c - 1] !== 0x3e) {
      skipped++;
      continue;
    }
    const hex = new TextDecoder("latin1").decode(
      pdf.subarray(gapStart + 1, c - 1),
    );
    const contents = hexToBytes(hex);
    if (!contents || contents.length === 0) {
      skipped++;
      continue;
    }
    found.push({ byteRange: [a, b, c, d], contents });
  }
  return { found, skipped };
}
