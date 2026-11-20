import type { ImageMime } from "./model";

/** An image's format and size, read from its header. */
export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

/** Value for the image picker's `accept` attribute. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,.png,.jpg,.jpeg";

/** Largest image accepted, in bytes. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Read a big-endian unsigned integer.
 *
 * @param bytes The data.
 * @param offset Where the number starts.
 * @param length 2 or 4 bytes.
 * @returns The number.
 */
function readUint(bytes: Uint8Array, offset: number, length: 2 | 4): number {
  let n = 0;
  for (let i = 0; i < length; i++) n = n * 256 + bytes[offset + i];
  return n;
}

/**
 * Size of a PNG from its IHDR chunk.
 *
 * A PNG starts with an 8-byte signature followed by the IHDR chunk: a 4-byte
 * length, the 4 letters "IHDR", then width and height as 4-byte big-endian
 * integers at offsets 16 and 20.
 *
 * @param bytes The file.
 * @returns The size, or `null` if this is not a well-formed PNG header.
 */
export function pngSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b))
    return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  return { width: readUint(bytes, 16, 4), height: readUint(bytes, 20, 4) };
}

/**
 * Size of a JPEG from its start-of-frame (SOF) segment.
 *
 * A JPEG is a series of segments, each starting with 0xFF and a marker
 * byte. After the start-of-image marker (FFD8), segments carry a 2-byte
 * length that includes itself, so the scan can hop from segment to segment.
 * The frame header is any SOF marker C0..CF except C4 (Huffman tables), C8
 * (reserved) and CC (arithmetic coding conditions). Inside it: 1 byte of
 * precision, then the height and the width as 2-byte big-endian integers.
 * Standalone markers (D0..D7, 01) have no length and are skipped as such.
 *
 * @param bytes The file.
 * @returns The size, or `null` if no frame header is found.
 */
export function jpegSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = readUint(bytes, i + 2, 2);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (i + 9 > bytes.length) return null;
      return {
        height: readUint(bytes, i + 5, 2),
        width: readUint(bytes, i + 7, 2),
      };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/**
 * Identify a PNG or JPEG by its content (not its name or the browser's MIME
 * guess, which can be wrong) and read its pixel size.
 *
 * @param bytes The file.
 * @returns Format and size, or `null` for anything else (including images
 *   with a zero width or height).
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const png = pngSize(bytes);
  if (png && png.width > 0 && png.height > 0)
    return { mime: "image/png", ...png };
  const jpeg = jpegSize(bytes);
  if (jpeg && jpeg.width > 0 && jpeg.height > 0)
    return { mime: "image/jpeg", ...jpeg };
  return null;
}
