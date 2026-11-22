/**
 * Identify an embedded image, to extract each distinct image once.
 *
 * A logo on every page is usually one image object drawn many times, and
 * users want it once, not once per page. PDFium's public API does not
 * expose the image's object number, so identity is derived from content: a
 * SHA-256 of the raw (still encoded) stream bytes, combined with what
 * decoding depends on: the pixel size, the filters and the colour space.
 * Hashing the raw stream is cheap (no decoding) and happens before the
 * expensive work, so a repeated image is never decoded twice.
 *
 * An image mask (a stencil) is painted in the current fill colour, so the
 * same stencil drawn in red and in blue gives two different pictures: the
 * paint colour is part of the key.
 *
 * Known limit: two images with byte-identical data but different soft
 * masks would share a key, because PDFium's public API cannot read a soft
 * mask without decoding the image. That takes two image objects embedding
 * the same pixels with different transparency, which is rare.
 */

/** What, besides the raw bytes, decides how an image decodes. */
export interface ImageKeyParts {
  width: number;
  height: number;
  filters: string[];
  colorspace: number;
  /** For image masks, the colour they are painted in ("r,g,b"); else null. */
  paintColor: string | null;
}

/**
 * Compute an image's identity key.
 *
 * @param raw The image's raw stream bytes.
 * @param parts Its size, filters, colour space and paint colour.
 * @returns A string such as "4x3|FlateDecode|7||<64 hex digits>" (the empty
 *   field is the paint colour of an image mask).
 */
export async function imageKey(
  raw: Uint8Array,
  parts: ImageKeyParts,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    raw as Uint8Array<ArrayBuffer>,
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${parts.width}x${parts.height}|${parts.filters.join(",")}|${parts.colorspace}|${parts.paintColor ?? ""}|${hex}`;
}
