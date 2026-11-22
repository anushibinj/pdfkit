/**
 * Decide when an embedded image can be saved as its original JPEG bytes.
 * Pure.
 *
 * A PDF stores a JPEG photo as an image whose only filter is DCTDecode: the
 * stream *is* a JPEG file. Saving those bytes as they are keeps the
 * original quality and size; decoding and re-encoding would either lose
 * quality (JPEG) or make the file several times larger (PNG). Measured on a
 * Chromium-printed PDF, the stream is byte-identical to the JPEG that was
 * put into the page.
 *
 * It is only safe when the JPEG's own colours mean what the PDF shows. The
 * PDF's colour space is applied on top of the JPEG data, so:
 * - DeviceGray / DeviceRGB, and their calibrated forms CalGray / CalRGB,
 *   have the same channels as the JPEG: safe.
 * - ICCBased is safe when its profile describes gray or RGB data. Chromium
 *   and macOS tag nearly every image this way (with an sRGB profile).
 * - CMYK (JPEGs from print workflows, often stored inverted), Lab,
 *   Separation, DeviceN and Indexed change what the samples mean: those
 *   images are decoded by PDFium and saved as PNG instead.
 * An image with more than one filter (for example DCTDecode inside
 * FlateDecode) is not a plain JPEG file and is decoded too.
 */

/** `FPDF_COLORSPACE_*` values (fpdf_edit.h). */
export const COLORSPACE = {
  UNKNOWN: 0,
  DEVICE_GRAY: 1,
  DEVICE_RGB: 2,
  DEVICE_CMYK: 3,
  CAL_GRAY: 4,
  CAL_RGB: 5,
  LAB: 6,
  ICC_BASED: 7,
  SEPARATION: 8,
  DEVICE_N: 9,
  INDEXED: 10,
  PATTERN: 11,
} as const;

/** What is known about an embedded image's encoding. */
export interface ImageEncodingInfo {
  /** Filter names in application order, e.g. ["DCTDecode"]. */
  filters: string[];
  /** One of {@link COLORSPACE}. */
  colorspace: number;
  /**
   * For ICCBased images, the profile's data colour space signature (see
   * {@link iccDataColourSpace}); otherwise null.
   */
  iccColourSpace: string | null;
}

/** Colour spaces whose channels match a gray or RGB JPEG one to one. */
const DIRECT_COLORSPACES: ReadonlySet<number> = new Set([
  COLORSPACE.DEVICE_GRAY,
  COLORSPACE.DEVICE_RGB,
  COLORSPACE.CAL_GRAY,
  COLORSPACE.CAL_RGB,
]);

/** ICC data colour spaces a browser shows correctly without the profile. */
const SAFE_ICC_SPACES: ReadonlySet<string> = new Set(["GRAY", "RGB "]);

/**
 * Read the data colour space of an ICC profile.
 *
 * Every ICC profile starts with a 128-byte header; bytes 16 to 19 hold the
 * colour space of the data it describes as four ASCII characters, such as
 * "RGB ", "GRAY", "CMYK" or "Lab " (ICC.1 specification, section 7.2.6).
 *
 * @param profile The profile's bytes.
 * @returns The four-character signature, or null if the data is too short.
 */
export function iccDataColourSpace(profile: Uint8Array): string | null {
  if (profile.length < 20) return null;
  return String.fromCharCode(...profile.subarray(16, 20));
}

/**
 * Whether the image's stream can be saved as a .jpg file unchanged.
 *
 * @param info The image's filters and colour space.
 * @returns `true` when the bytes are a JPEG that shows the same colours.
 */
export function canKeepOriginalJpeg(info: ImageEncodingInfo): boolean {
  if (info.filters.length !== 1) return false;
  // PDFium expands the inline-image abbreviation "DCT"; accept both.
  if (info.filters[0] !== "DCTDecode" && info.filters[0] !== "DCT") {
    return false;
  }
  if (DIRECT_COLORSPACES.has(info.colorspace)) return true;
  return (
    info.colorspace === COLORSPACE.ICC_BASED &&
    info.iccColourSpace !== null &&
    SAFE_ICC_SPACES.has(info.iccColourSpace)
  );
}
