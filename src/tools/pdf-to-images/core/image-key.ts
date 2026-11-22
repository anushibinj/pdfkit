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
 * Known limit: two images with byte-identical data but different soft
 * masks would share a key. That needs two separate image objects that
 * embed the same pixels with different transparency, which PDF producers
 * do not do in practice.
 */

/** What, besides the raw bytes, decides how an image decodes. */
export interface ImageKeyParts {
  width: number;
  height: number;
  filters: string[];
  colorspace: number;
}

/**
 * Compute an image's identity key.
 *
 * @param raw The image's raw stream bytes.
 * @param parts Its size, filters and colour space.
 * @returns A string such as "4x3|FlateDecode|7|<64 hex digits>".
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
  return `${parts.width}x${parts.height}|${parts.filters.join(",")}|${parts.colorspace}|${hex}`;
}
