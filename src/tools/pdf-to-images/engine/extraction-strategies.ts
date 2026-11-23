/**
 * How an embedded image is turned into a file, as a chain of strategies
 * (Chain of Responsibility): each one either produces the image or returns
 * null to let the next one try. The default chain, best first:
 *
 * 1. {@link OriginalJpegStrategy}: the stream already is a JPEG showing the
 *    right colours and the image has no transparency; keep its bytes
 *    (original quality, original size).
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
 * Whether an image object is drawn through a clip path.
 *
 * `FPDFClipPath_CountPaths` answers -1 when the object has no clip at all.
 * PDFium drops a single rectangular clip that contains the object while
 * parsing (cpdf_contentparser.cpp), so a remaining clip usually cuts the
 * image.
 *
 * @param api The PDFium module.
 * @param object The image object.
 * @returns `true` when a clip applies.
 */
export function hasClipPath(api: ImagesPdfiumApi, object: number): boolean {
  return (
    api.FPDFClipPath_CountPaths(api.FPDFPageObj_GetClipPath(object)) !== -1
  );
}

/**
 * Whether every pixel of an RGBA image is fully opaque.
 *
 * @param pixels RGBA bytes.
 * @returns `false` as soon as one alpha is below 255.
 */
export function isOpaque(pixels: Uint8Array): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) return false;
  }
  return true;
}

/**
 * Draws an image object on its own, at any size, with its transparency.
 *
 * `FPDFImageObj_GetRenderedBitmap` draws the image the way the page does
 * (soft mask, stencil, colour key and clip applied) into a bitmap as large
 * as the image's matrix makes it on the page, in points. The trick, step by
 * step:
 * 1. Save the image's matrix and replace it with [width, 0, 0, height, 0, 0]:
 *    the image then covers exactly width x height units, so the bitmap has
 *    that size. At the image's own pixel size every pixel maps 1:1 (no
 *    resampling); at a smaller size PDFium averages, alpha included.
 *    Rotation and flips on the page are dropped, like any extractor does.
 * 2. Set the fill alpha (`ca`) to 1 with `FPDFPageObj_SetFillColor`, so an
 *    image drawn half-transparent comes out with its own alpha. The fill
 *    colour is read first and kept, because a stencil mask is painted in it.
 * 3. Render, convert to RGBA, destroy the bitmap, restore the matrix.
 * The changes only live in the loaded page, which is closed without being
 * saved, so the document is never modified.
 *
 * Measured with the real engine: the render applies the image's mask and
 * its clip path, and ignores blend modes. Callers skip clipped images.
 */
export class NativeImageRenderer {
  /**
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   */
  constructor(
    private readonly api: ImagesPdfiumApi,
    private readonly heap: WasmHeap,
  ) {}

  /**
   * Draw the image at `width` x `height` pixels.
   *
   * @param context The image and where it lives.
   * @param width Output width in pixels.
   * @param height Output height in pixels.
   * @returns The pixels, or null when PDFium draws nothing (for example an
   *   image in a hidden layer) or the matrix cannot be read.
   */
  render(
    { doc, page, image }: ExtractionContext,
    width: number,
    height: number,
  ): RgbaImage | null {
    const { object } = image;
    return this.heap.using(this.heap.alloc(24), (original) => {
      if (!this.api.FPDFPageObj_GetMatrix(object, original)) return null;
      const target = this.heap.floats([width, 0, 0, height, 0, 0]);
      try {
        this.heap.using(target, (m) =>
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
          return readBitmap(this.api, bitmap);
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

/** Tells whether an image has transparency, before it is extracted. */
export interface TransparencyProbe {
  /**
   * @param context The image.
   * @returns `true` when some of it is transparent; `false` when it is
   *   opaque or that cannot be told.
   */
  hasTransparency(context: ExtractionContext): boolean;
}

/** Longest side of the probe render, in pixels. */
export const PROBE_SIZE = 512;

/**
 * Finds transparency by drawing the image small.
 *
 * PDFium's public API cannot say whether an image has a soft mask, so the
 * image is drawn with its mask at most {@link PROBE_SIZE} pixels on its
 * longest side and its alpha is checked. Measured on the real engine:
 * downscaling averages alpha, so even one transparent pixel of a
 * 4000 x 3000 image shows (alpha 250 at 512 pixels), and the probe costs
 * about a third of a full decode (decoding dominates).
 *
 * It answers "cannot tell" (false) when drawing would not show the mask
 * alone: for a clipped image (the clip would look like transparency) and
 * for an image too large to decode; the image is then kept as it is.
 */
export class RenderedTransparencyProbe implements TransparencyProbe {
  /** @param renderer Draws images (see {@link NativeImageRenderer}). */
  constructor(
    private readonly renderer: Pick<NativeImageRenderer, "render">,
    private readonly api: ImagesPdfiumApi,
  ) {}

  /** @inheritDoc */
  hasTransparency(context: ExtractionContext): boolean {
    const { image } = context;
    if (hasClipPath(this.api, image.object)) return false;
    if (image.width * image.height > MAX_DECODED_PIXELS) return false;
    const scale = Math.min(1, PROBE_SIZE / Math.max(image.width, image.height));
    const probe = this.renderer.render(
      context,
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    return probe !== null && !isOpaque(probe.pixels);
  }
}

/**
 * Keep a JPEG stream as it is.
 *
 * Applies when {@link canKeepOriginalJpeg} says the colours are right, the
 * bytes start with a JPEG's start-of-image marker (FF D8; PDFium may still
 * decode a damaged stream that a browser would not open), and the image has
 * no transparency. A JPEG cannot hold alpha, so a photo with a soft mask is
 * left to {@link MaskedRenderStrategy}, which saves it as a PNG with its
 * transparency.
 */
export class OriginalJpegStrategy implements ImageExtractionStrategy {
  /** @param probe Finds images with transparency. */
  constructor(private readonly probe: TransparencyProbe) {}

  /** @inheritDoc */
  extract(context: ExtractionContext): ExtractedImage | null {
    const { image } = context;
    const { raw } = image;
    if (!canKeepOriginalJpeg(image) || raw[0] !== 0xff || raw[1] !== 0xd8) {
      return null;
    }
    if (this.probe.hasTransparency(context)) return null;
    return { method: "original-jpeg", mimeType: "image/jpeg", bytes: raw };
  }
}

/**
 * Decode an image at its own pixel size with its transparency, by drawing
 * it with {@link NativeImageRenderer} at that size.
 *
 * Skipped for images with a clip path (the clip would cut away parts of
 * the image); the next strategy then decodes them whole, without
 * transparency. A null drawing (an image in a hidden layer) also passes to
 * the next strategy.
 */
export class MaskedRenderStrategy implements ImageExtractionStrategy {
  /**
   * @param renderer Draws images.
   * @param api The PDFium module.
   */
  constructor(
    private readonly renderer: Pick<NativeImageRenderer, "render">,
    private readonly api: ImagesPdfiumApi,
  ) {}

  /** @inheritDoc */
  extract(context: ExtractionContext): ExtractedImage | null {
    const { image } = context;
    if (hasClipPath(this.api, image.object)) return null;
    assertDecodable(image);
    const pixels = this.renderer.render(context, image.width, image.height);
    return pixels ? { method: "decoded-with-alpha", pixels } : null;
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
 * The default chain, best result first, sharing one renderer.
 *
 * @param api The PDFium module.
 * @param heap Memory helper for that module.
 * @returns The strategies in the order to try them.
 */
export function defaultStrategies(
  api: ImagesPdfiumApi,
  heap: WasmHeap,
): ImageExtractionStrategy[] {
  const renderer = new NativeImageRenderer(api, heap);
  return [
    new OriginalJpegStrategy(new RenderedTransparencyProbe(renderer, api)),
    new MaskedRenderStrategy(renderer, api),
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
