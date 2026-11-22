/**
 * A lossless PNG encoder (PNG specification, W3C, third edition).
 *
 * Why not `canvas.toBlob("image/png")`: a canvas stores premultiplied
 * alpha, so a semi-transparent pixel's colour is rounded on the way in and
 * out and does not survive exactly. This encoder writes the given RGBA
 * values unchanged, which is what "extract the image" has to mean.
 *
 * Pipeline: pick the smallest colour type that represents every pixel
 * exactly -> pack the samples -> filter each scanline -> zlib-compress
 * (injected, see `deflateZlib`) -> wrap in IHDR / IDAT / IEND chunks.
 * Only 8-bit samples, no interlacing, no palette.
 */
import { crc32 } from "@/lib/crc32";

/** Pixels to encode: 8-bit RGBA, straight (not premultiplied) alpha. */
export interface RgbaImage {
  width: number;
  height: number;
  /** width * height * 4 bytes, rows top to bottom. */
  pixels: Uint8Array;
}

/** Compresses bytes to a zlib stream (RFC 1950), as PNG's IDAT requires. */
export type Deflate = (data: Uint8Array) => Promise<Uint8Array>;

/** PNG colour types used here (PNG spec, table 11.1). */
export const PNG_COLOR_TYPE = {
  GRAY: 0,
  RGB: 2,
  GRAY_ALPHA: 4,
  RGBA: 6,
} as const;

export type PngColorType = (typeof PNG_COLOR_TYPE)[keyof typeof PNG_COLOR_TYPE];

/** The eight bytes every PNG file starts with. */
const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/** IDAT data is split into chunks of at most this many bytes. */
export const MAX_IDAT_CHUNK = 1 << 20;
/** Largest width or height the PNG format allows (2^31 - 1). */
const MAX_DIMENSION = 0x7fffffff;

/**
 * Pick the smallest colour type that stores every pixel exactly.
 *
 * - If every alpha is 255 the alpha channel carries no information and is
 *   dropped (25% fewer bytes before compression).
 * - If every pixel has r == g == b, one gray sample replaces three. This is
 *   checked on all pixels, transparent ones included, so decoding gives back
 *   exactly the input.
 * One pass over the pixels; it stops early once neither shortcut applies.
 *
 * @param pixels RGBA bytes.
 * @returns The colour type to write.
 */
export function chooseColorType(pixels: Uint8Array): PngColorType {
  let opaque = true;
  let gray = true;
  for (let i = 0; i < pixels.length && (opaque || gray); i += 4) {
    if (pixels[i + 3] !== 255) opaque = false;
    if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) {
      gray = false;
    }
  }
  if (gray) return opaque ? PNG_COLOR_TYPE.GRAY : PNG_COLOR_TYPE.GRAY_ALPHA;
  return opaque ? PNG_COLOR_TYPE.RGB : PNG_COLOR_TYPE.RGBA;
}

/**
 * Bytes per pixel of a colour type at 8 bits per sample.
 *
 * @param colorType The colour type.
 * @returns 1 (gray), 2 (gray + alpha), 3 (RGB) or 4 (RGBA).
 */
export function bytesPerPixel(colorType: PngColorType): number {
  switch (colorType) {
    case PNG_COLOR_TYPE.GRAY:
      return 1;
    case PNG_COLOR_TYPE.GRAY_ALPHA:
      return 2;
    case PNG_COLOR_TYPE.RGB:
      return 3;
    case PNG_COLOR_TYPE.RGBA:
      return 4;
  }
}

/**
 * Convert RGBA pixels to the samples of `colorType`, rows back to back.
 *
 * For the gray types the red sample is kept (red, green and blue are equal,
 * see {@link chooseColorType}).
 *
 * @param pixels RGBA bytes.
 * @param colorType The target colour type.
 * @returns The packed samples.
 */
export function packPixels(
  pixels: Uint8Array,
  colorType: PngColorType,
): Uint8Array {
  if (colorType === PNG_COLOR_TYPE.RGBA) return pixels;
  const count = pixels.length / 4;
  const bpp = bytesPerPixel(colorType);
  const out = new Uint8Array(count * bpp);
  for (let p = 0, i = 0, o = 0; p < count; p++, i += 4, o += bpp) {
    switch (colorType) {
      case PNG_COLOR_TYPE.GRAY:
        out[o] = pixels[i];
        break;
      case PNG_COLOR_TYPE.GRAY_ALPHA:
        out[o] = pixels[i];
        out[o + 1] = pixels[i + 3];
        break;
      case PNG_COLOR_TYPE.RGB:
        out[o] = pixels[i];
        out[o + 1] = pixels[i + 1];
        out[o + 2] = pixels[i + 2];
        break;
    }
  }
  return out;
}

/**
 * The Paeth predictor (PNG spec, section 9.4): of the left (a), above (b)
 * and upper-left (c) neighbours, pick the one closest to a + b - c, the
 * value a straight gradient through the three would predict. Ties prefer a,
 * then b, as the specification requires.
 *
 * @param a Left neighbour.
 * @param b Neighbour above.
 * @param c Upper-left neighbour.
 * @returns The predicted byte.
 */
export function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Apply one PNG filter to one scanline and score the result.
 *
 * Each filter has its own loop instead of one loop that switches on the
 * filter type for every byte: the encoder runs this five times per row,
 * so the per-byte work is kept as small as possible. Within a row, the first `bpp` bytes have no left
 * neighbour (a = c = 0), which simplifies the predictors there:
 * Sub keeps x, Average subtracts floor(b / 2), and Paeth predicts b
 * (with a = c = 0, b is never farther from a + b - c than a or c, and on a
 * tie with a both are 0).
 *
 * @param type Filter type, 0 (None) to 4 (Paeth).
 * @param row The scanline's bytes.
 * @param above The previous scanline (zeros for the first).
 * @param bpp Bytes per pixel.
 * @param out Receives the filtered bytes (same length as `row`).
 * @returns The sum of the output bytes read as signed numbers, made
 *   absolute: lower means the row will compress better.
 */
export function filterRow(
  type: number,
  row: Uint8Array,
  above: Uint8Array,
  bpp: number,
  out: Uint8Array,
): number {
  const n = row.length;
  const lead = Math.min(bpp, n);
  let score = 0;
  // Every branch below does the same three steps per byte, written out
  // in place (a helper closure measured slower): v = (x - prediction) mod
  // 256, store it, and add |v| read as a signed byte to the score.
  let v: number;
  switch (type) {
    case 0:
      for (let i = 0; i < n; i++) {
        v = row[i];
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      break;
    case 1:
      for (let i = 0; i < lead; i++) {
        v = row[i];
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      for (let i = bpp; i < n; i++) {
        v = (row[i] - row[i - bpp]) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      break;
    case 2:
      for (let i = 0; i < n; i++) {
        v = (row[i] - above[i]) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      break;
    case 3:
      for (let i = 0; i < lead; i++) {
        v = (row[i] - (above[i] >> 1)) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      for (let i = bpp; i < n; i++) {
        v = (row[i] - ((row[i - bpp] + above[i]) >> 1)) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      break;
    default:
      for (let i = 0; i < lead; i++) {
        v = (row[i] - above[i]) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      for (let i = bpp; i < n; i++) {
        // Paeth (see {@link paeth}), inlined: this is the hottest loop.
        const a = row[i - bpp];
        const b = above[i];
        const c = above[i - bpp];
        const pa = Math.abs(b - c); // |p - a| with p = a + b - c
        const pb = Math.abs(a - c); // |p - b|
        const pc = Math.abs(a + b - 2 * c); // |p - c|
        const predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (row[i] - predicted) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
  }
  return score;
}

/**
 * Filter every scanline, choosing the filter per row.
 *
 * PNG compresses better when each byte is replaced by its difference from
 * a prediction: smooth areas turn into runs of small numbers that deflate
 * well. There are five filters (spec, section 9.2), where for each byte x,
 * a = the same byte of the pixel to the left, b = the byte above and c =
 * the byte above-left (0 outside the image):
 *   0 None: x;  1 Sub: x - a;  2 Up: x - b;  3 Average: x - floor((a+b)/2);
 *   4 Paeth: x - paeth(a, b, c);  all modulo 256.
 * Which filter is best varies per row, so each row is filtered all five
 * ways and the one with the smallest sum of absolute values (reading each
 * output byte as a signed number, so 255 counts as -1) is kept. That is the
 * "minimum sum of absolute differences" heuristic recommended by the spec
 * (section 12.8) and used by libpng.
 *
 * @param packed Packed samples (see {@link packPixels}).
 * @param width Pixels per row.
 * @param height Number of rows.
 * @param bpp Bytes per pixel.
 * @returns Each row prefixed by its filter type byte.
 */
export function filterScanlines(
  packed: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array {
  const rowBytes = width * bpp;
  const out = new Uint8Array((rowBytes + 1) * height);
  // One scratch row per filter type, reused for every scanline.
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(rowBytes));
  const zeroRow = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = packed.subarray(y * rowBytes, (y + 1) * rowBytes);
    const above =
      y > 0 ? packed.subarray((y - 1) * rowBytes, y * rowBytes) : zeroRow;
    let best = 0;
    let bestScore = Infinity;
    for (let type = 0; type < 5; type++) {
      const score = filterRow(type, row, above, bpp, candidates[type]);
      if (score < bestScore) {
        bestScore = score;
        best = type;
      }
    }
    const at = y * (rowBytes + 1);
    out[at] = best;
    out.set(candidates[best], at + 1);
  }
  return out;
}

/**
 * The IHDR chunk's 13 data bytes (spec, section 11.2.1): width, height,
 * bit depth 8, the colour type, compression 0 (deflate), filter method 0
 * (adaptive), interlace 0 (none).
 *
 * @param width Image width.
 * @param height Image height.
 * @param colorType Colour type.
 * @returns The chunk data.
 */
export function ihdrData(
  width: number,
  height: number,
  colorType: PngColorType,
): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8;
  data[9] = colorType;
  // bytes 10-12 (compression, filter, interlace) stay 0
  return data;
}

/**
 * Lay out a PNG file: signature, IHDR, the compressed data split into IDAT
 * chunks of at most {@link MAX_IDAT_CHUNK} bytes, IEND.
 *
 * Each chunk is: 4-byte big-endian data length, 4-byte ASCII type, the
 * data, and a CRC-32 of type + data. The output size is known up front, so
 * everything is written into one buffer (no intermediate copies).
 *
 * @param header IHDR data.
 * @param compressed The zlib stream of the filtered scanlines.
 * @returns The PNG file.
 */
export function assemblePng(
  header: Uint8Array,
  compressed: Uint8Array,
): Uint8Array {
  const idatCount = Math.max(1, Math.ceil(compressed.length / MAX_IDAT_CHUNK));
  const size =
    SIGNATURE.length +
    12 +
    header.length +
    12 * idatCount +
    compressed.length +
    12;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let at = SIGNATURE.length;
  const writeChunk = (type: string, data: Uint8Array) => {
    const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
    view.setUint32(at, data.length);
    out.set(typeBytes, at + 4);
    out.set(data, at + 8);
    view.setUint32(at + 8 + data.length, crc32(data, crc32(typeBytes)));
    at += 12 + data.length;
  };
  writeChunk("IHDR", header);
  for (let i = 0; i < idatCount; i++) {
    writeChunk(
      "IDAT",
      compressed.subarray(i * MAX_IDAT_CHUNK, (i + 1) * MAX_IDAT_CHUNK),
    );
  }
  writeChunk("IEND", new Uint8Array(0));
  return out;
}

/**
 * Encode RGBA pixels as a PNG file, losslessly.
 *
 * @param image The pixels.
 * @param deflate zlib compressor (`deflateZlib` in browsers and workers).
 * @returns The PNG file.
 * @throws {RangeError} When the size is invalid or the pixel buffer does not
 *   match it.
 */
export async function encodePng(
  image: RgbaImage,
  deflate: Deflate,
): Promise<Uint8Array> {
  const { width, height, pixels } = image;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    throw new RangeError(`Invalid PNG size ${width}x${height}`);
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError("Pixel buffer does not match the image size");
  }
  const colorType = chooseColorType(pixels);
  const bpp = bytesPerPixel(colorType);
  const filtered = filterScanlines(
    packPixels(pixels, colorType),
    width,
    height,
    bpp,
  );
  return assemblePng(
    ihdrData(width, height, colorType),
    await deflate(filtered),
  );
}
