/**
 * How an embedded image is turned into a file, as a chain of strategies
 * (Chain of Responsibility): each one either produces the image or returns
 * null to let the next one try. The default chain, best first:
 *
 * 1. {@link OriginalJpegStrategy}: the stream already is a JPEG showing the
 *    right colours; keep its bytes (original quality, original size).
 * 2. {@link MaskedRenderStrategy}: decode at the image's own pixel size with
 *    its transparency (soft mask, stencil, colour key) applied.
 * 3. {@link DecodedBitmapStrategy}: decode at the image's own pixel size,
 *    without transparency. Always applicable, so the chain always ends.
 *
 * New ways to extract (say, keeping JPEG 2000 streams) are added as new
 * strategies without changing the session that runs the chain.
 */
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { RgbaImage } from "@/lib/png/png-encoder";
import { bitmapToRgba } from "../core/bitmap-format";
import { canKeepOriginalJpeg } from "../core/jpeg-passthrough";
import type { EmbeddedImage } from "./image-inspector";
import type { ImagesPdfiumApi } from "./pdfium-api";

/** Which strategy produced an image (shown to the user as its source). */
export type ExtractionMethod =
  "original-jpeg" | "decoded-with-alpha" | "decoded";

/** An extracted image: original JPEG bytes, or decoded pixels to encode. */
export type ExtractedImage =
  | { method: "original-jpeg"; mimeType: "image/jpeg"; bytes: Uint8Array }
  | { method: "decoded-with-alpha" | "decoded"; pixels: RgbaImage };

/** The image to extract and where it lives. */
export interface ExtractionContext {
  /** The open `FPDF_DOCUMENT`. */
  doc: number;
  /** The loaded `FPDF_PAGE` holding the image. */
  page: number;
  image: EmbeddedImage;
}

/** One way of extracting an image. */
export interface ImageExtractionStrategy {
  /**
   * @param context The image.
   * @returns The extracted image, or null when this strategy does not apply
   *   or could not produce it.
   */
  extract(context: ExtractionContext): ExtractedImage | null;
}

/**
 * Most pixels an image may have to be decoded: 40 million (a page scanned
 * at 600 DPI is about 35 million). Decoding needs about 4 bytes per pixel
 * in the engine plus the same again for encoding; beyond this a phone
 * would run out of memory. Original JPEGs are not decoded, so they have no
 * such limit.
 */
export const MAX_DECODED_PIXELS = 40_000_000;

/** An image is too large to decode in the browser. */
export class ImageTooLargeError extends Error {
  /**
   * @param width Its width in pixels.
   * @param height Its height in pixels.
   */
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super(
      `This image is ${width} x ${height} pixels, too large to decode in the browser.`,
    );
    this.name = "ImageTooLargeError";
  }
}

/**
 * Refuse to decode an image above {@link MAX_DECODED_PIXELS}.
 *
 * @param image The image.
 * @throws {ImageTooLargeError} When it is too large.
 */
export function assertDecodable(image: EmbeddedImage): void {
  if (image.width * image.height > MAX_DECODED_PIXELS) {
    throw new ImageTooLargeError(image.width, image.height);
  }
}

/**
 * Convert a PDFium bitmap to RGBA pixels. The bitmap is not destroyed (its
 * owner does that).
 *
 * The pixels are read through a view of the WebAssembly memory instead of
 * a copy: `bitmapToRgba` writes into a new JavaScript array and allocates
 * nothing inside the engine, so the memory cannot grow (which would
 * invalidate the view) while it reads. This saves one full-size copy of
 * every image.
 *
 * @param api The PDFium module.
 * @param bitmap An `FPDF_BITMAP`.
 * @returns The pixels.
 */
export function readBitmap(api: ImagesPdfiumApi, bitmap: number): RgbaImage {
  const width = api.FPDFBitmap_GetWidth(bitmap);
  const height = api.FPDFBitmap_GetHeight(bitmap);
  const stride = api.FPDFBitmap_GetStride(bitmap);
  const format = api.FPDFBitmap_GetFormat(bitmap);
  const buffer = api.FPDFBitmap_GetBuffer(bitmap);
  const data = api.pdfium.HEAPU8.subarray(buffer, buffer + stride * height);
  return {
    width,
    height,
    pixels: bitmapToRgba({ width, height, stride, format, data }),
  };
}

/**
 * Keep a JPEG stream as it is.
 *
 * Applies when {@link canKeepOriginalJpeg} says the colours are right and
 * the bytes start with a JPEG's start-of-image marker (FF D8). The marker
 * check guards against damaged streams: PDFium may still decode them, a
 * browser would not open them.
 */
export class OriginalJpegStrategy implements ImageExtractionStrategy {
  /** @inheritDoc */
  extract({ image }: ExtractionContext): ExtractedImage | null {
    const { raw } = image;
    if (!canKeepOriginalJpeg(image) || raw[0] !== 0xff || raw[1] !== 0xd8) {
      return null;
    }
    return { method: "original-jpeg", mimeType: "image/jpeg", bytes: raw };
  }
}

/**
 * Decode an image at its own pixel size with its transparency.
 *
 * `FPDFImageObj_GetRenderedBitmap` draws the image the way the page does,
 * mask included, into a bitmap as large as the image's matrix makes it on
 * the page (in points, not pixels). The trick, step by step:
 * 1. Save the image's matrix and replace it with [width, 0, 0, height, 0, 0]:
 *    the image then covers exactly width x height units, one per pixel, so
 *    the bitmap has the image's own size and every pixel maps 1:1 (no
 *    resampling; rotation and flips on the page are dropped, like any
 *    image extractor does).
 * 2. Set the fill alpha (`ca`) to 1 with `FPDFPageObj_SetFillColor`, so an
 *    image drawn half-transparent comes out with its own alpha. The fill
 *    colour is read first and kept, because a stencil mask is painted in it.
 * 3. Render, convert to RGBA, destroy the bitmap, restore the matrix.
 * The changes only live in the loaded page, which is closed without being
 * saved, so the document is never modified.
 *
 * Measured with the real engine: the render applies the image's soft mask
 * and its clip path, and ignores blend modes. So it is skipped when the
 * image has a clip path (the clip would cut away parts of the image); the
 * next strategy then decodes it whole, without transparency. PDFium itself
 * drops a rectangular clip that contains the image while parsing, so this
 * only happens for images that really are cropped. A null bitmap (for
 * example an image in a hidden layer) also passes to the next strategy.
 */
export class MaskedRenderStrategy implements ImageExtractionStrategy {
  /**
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   */
  constructor(
    private readonly api: ImagesPdfiumApi,
    private readonly heap: WasmHeap,
  ) {}

  /** @inheritDoc */
  extract({ doc, page, image }: ExtractionContext): ExtractedImage | null {
    const { object, width, height } = image;
    const clip = this.api.FPDFPageObj_GetClipPath(object);
    if (this.api.FPDFClipPath_CountPaths(clip) !== -1) return null;
    assertDecodable(image);
    return this.heap.using(this.heap.alloc(24), (original) => {
      if (!this.api.FPDFPageObj_GetMatrix(object, original)) return null;
      const native = this.heap.floats([width, 0, 0, height, 0, 0]);
      try {
        this.heap.using(native, (m) =>
          this.api.FPDFPageObj_SetMatrix(object, m),
        );
        this.neutraliseOpacity(object);
        const bitmap = this.api.FPDFImageObj_GetRenderedBitmap(
          doc,
          page,
          object,
        );
        if (!bitmap) return null;
        try {
          return {
            method: "decoded-with-alpha",
            pixels: readBitmap(this.api, bitmap),
          };
        } finally {
          this.api.FPDFBitmap_Destroy(bitmap);
        }
      } finally {
        this.api.FPDFPageObj_SetMatrix(object, original);
      }
    });
  }

  /**
   * Set the object's fill alpha to opaque, keeping its fill colour.
   *
   * `FPDFPageObj_GetFillColor` only succeeds for image masks (the only
   * images painted in a fill colour); for other images black is passed,
   * which their rendering ignores.
   *
   * @param object The image object.
   */
  private neutraliseOpacity(object: number): void {
    const [r, g, b] = this.heap.using(this.heap.alloc(16), (ptr) =>
      this.api.FPDFPageObj_GetFillColor(object, ptr, ptr + 4, ptr + 8, ptr + 12)
        ? this.heap.readInts(ptr, 3)
        : [0, 0, 0],
    );
    this.api.FPDFPageObj_SetFillColor(object, r, g, b, 255);
  }
}

/**
 * Decode an image at its own pixel size, without transparency, with
 * `FPDFImageObj_GetBitmap` (colour space and decode arrays applied; mask
 * and matrix ignored). The last resort of the chain: it applies to every
 * image PDFium can decode.
 */
export class DecodedBitmapStrategy implements ImageExtractionStrategy {
  /** @param api The PDFium module. */
  constructor(private readonly api: ImagesPdfiumApi) {}

  /** @inheritDoc */
  extract({ image }: ExtractionContext): ExtractedImage | null {
    assertDecodable(image);
    const bitmap = this.api.FPDFImageObj_GetBitmap(image.object);
    if (!bitmap) return null;
    try {
      return { method: "decoded", pixels: readBitmap(this.api, bitmap) };
    } finally {
      this.api.FPDFBitmap_Destroy(bitmap);
    }
  }
}

/**
 * The default chain, best result first.
 *
 * @param api The PDFium module.
 * @param heap Memory helper for that module.
 * @returns The strategies in the order to try them.
 */
export function defaultStrategies(
  api: ImagesPdfiumApi,
  heap: WasmHeap,
): ImageExtractionStrategy[] {
  return [
    new OriginalJpegStrategy(),
    new MaskedRenderStrategy(api, heap),
    new DecodedBitmapStrategy(api),
  ];
}

/**
 * Run the chain: the first strategy that produces the image wins.
 *
 * @param strategies The chain.
 * @param context The image.
 * @returns The extracted image.
 * @throws {Error} When no strategy could produce it (PDFium cannot decode
 *   the image), or what a strategy threw (for example
 *   {@link ImageTooLargeError}).
 */
export function extractImage(
  strategies: readonly ImageExtractionStrategy[],
  context: ExtractionContext,
): ExtractedImage {
  for (const strategy of strategies) {
    const result = strategy.extract(context);
    if (result) return result;
  }
  throw new Error("PDFium could not decode this image.");
}
