import type { ImageMime } from "./image-info";

/** Decodes an image (the browser's `createImageBitmap`, or a test fake). */
export type ImageDecoder = (blob: Blob) => Promise<{ close(): void }>;

/**
 * Check that the browser can actually decode an image, not only read its
 * header.
 *
 * A file can have a valid PNG or JPEG header and still be damaged (a bad
 * checksum, cut off halfway); the PDF engine would then embed something
 * that draws nothing. Decoding it once here lets the page refuse it as
 * soon as it is picked. The decoded bitmap is closed straight away to free
 * its memory.
 *
 * Where no decoder exists (old browsers, test environments), the answer is
 * `true`: this check only gives earlier feedback, and the worker checks
 * the picture again with PDFium in any case.
 *
 * @param bytes The file.
 * @param mime Its format, from `readImageInfo`.
 * @param decode The decoder (defaults to `createImageBitmap`).
 * @returns `false` only when decoding was tried and failed.
 */
export async function canDecodeImage(
  bytes: ArrayBuffer,
  mime: ImageMime,
  decode: ImageDecoder | undefined = typeof createImageBitmap === "function"
    ? (blob) => createImageBitmap(blob)
    : undefined,
): Promise<boolean> {
  if (!decode) return true;
  try {
    const bitmap = await decode(new Blob([bytes], { type: mime }));
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}
