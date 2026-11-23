import type { ImageMime } from "@/lib/image-info";
import type { Size } from "@/lib/pdfium/page-box";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { ImagesToPdfPdfiumApi } from "./pdfium-api";

/** User-facing message when PDFium cannot decode an image payload. */
export const UNREADABLE_IMAGE_MESSAGE =
  "This image could not be read. It may be damaged or unsupported; try another PNG or JPEG file.";

/**
 * Thrown when a specific image cannot be embedded or decoded by PDFium.
 * Carrying `imageIndex` lets the UI name the exact file that failed.
 */
export class InvalidImageError extends Error {
  /**
   * @param message Human-readable explanation.
   * @param imageIndex Zero-based index of the offending image, if known.
   */
  constructor(
    message: string,
    readonly imageIndex?: number,
  ) {
    super(message);
    this.name = "InvalidImageError";
  }
}

/**
 * Open/Closed Principle (OCP) & Liskov Substitution Principle (LSP):
 * format-specific strategy for loading image bytes into a PDFium image object.
 *
 * Adding support for a new image format (e.g. WebP decoded to raw bitmap) only
 * requires implementing this interface and registering it with
 * {@link CompositeImageEmbedder}, without modifying existing strategies or the
 * PDF builder.
 */
export interface ImageEmbedStrategy {
  /**
   * Check whether this strategy handles the given image MIME type.
   *
   * @param mime Image MIME type.
   * @returns `true` if this strategy can load `mime`.
   */
  supports(mime: ImageMime): boolean;

  /**
   * Load raw image bytes (already copied into WASM heap at `dataPtr`) into
   * the PDFium image `object`.
   *
   * @param api PDFium bindings.
   * @param page Target `FPDF_PAGE` handle.
   * @param object Newly created `FPDF_PAGEOBJECT` image handle.
   * @param dataPtr WASM heap pointer to the image bytes.
   * @param byteLength Length of the image bytes in `dataPtr`.
   * @returns `true` if PDFium accepted the payload.
   */
  loadIntoObject(
    api: ImagesToPdfPdfiumApi,
    page: number,
    object: number,
    dataPtr: number,
    byteLength: number,
  ): boolean;
}

/**
 * High-level contract used by {@link ImagesToPdfBuilder} to embed image bytes
 * into a PDFium image object and verify that PDFium decoded them cleanly
 * (Dependency Inversion Principle).
 */
export interface ImageEmbedder {
  /**
   * Copy `bytes` into WASM memory, load them into `object`, verify the decoded
   * pixel dimensions are non-zero, and free the temporary WASM buffer.
   *
   * @param api PDFium bindings.
   * @param heap WASM memory helper.
   * @param page Target `FPDF_PAGE` handle.
   * @param object Newly created `FPDF_PAGEOBJECT` image handle.
   * @param mime Image format.
   * @param bytes Raw image bytes.
   * @returns Decoded pixel dimensions reported by PDFium.
   * @throws {InvalidImageError} When no strategy supports `mime`, loading
   *   fails, or PDFium decodes the image as `0 x 0`.
   */
  embed(
    api: ImagesToPdfPdfiumApi,
    heap: WasmHeap,
    page: number,
    object: number,
    mime: ImageMime,
    bytes: Uint8Array,
  ): Size;
}

/**
 * Strategy for embedding PNG images via `EPDFImageObj_SetPng`.
 * PDFium decodes PNGs and preserves any alpha channel as a PDF `/SMask`.
 */
export class PngEmbedStrategy implements ImageEmbedStrategy {
  /**
   * @param mime Image MIME type.
   * @returns `true` only for `"image/png"`.
   */
  supports(mime: ImageMime): boolean {
    return mime === "image/png";
  }

  /**
   * Load PNG bytes into `object`.
   *
   * @param api PDFium bindings.
   * @param page Target page handle.
   * @param object Image object handle.
   * @param dataPtr WASM heap pointer to PNG bytes.
   * @param byteLength Byte length of PNG payload.
   * @returns `true` if PDFium accepted the PNG.
   */
  loadIntoObject(
    api: ImagesToPdfPdfiumApi,
    page: number,
    object: number,
    dataPtr: number,
    byteLength: number,
  ): boolean {
    return api.EPDFImageObj_SetPng(page, 0, object, dataPtr, byteLength);
  }
}

/**
 * Strategy for embedding JPEG images via `EPDFImageObj_SetJpeg`.
 * PDFium embeds the original compressed JPEG stream directly (`/DCTDecode`),
 * avoiding generation loss and keeping output file sizes compact.
 */
export class JpegEmbedStrategy implements ImageEmbedStrategy {
  /**
   * @param mime Image MIME type.
   * @returns `true` only for `"image/jpeg"`.
   */
  supports(mime: ImageMime): boolean {
    return mime === "image/jpeg";
  }

  /**
   * Load JPEG bytes into `object`.
   *
   * @param api PDFium bindings.
   * @param page Target page handle.
   * @param object Image object handle.
   * @param dataPtr WASM heap pointer to JPEG bytes.
   * @param byteLength Byte length of JPEG payload.
   * @returns `true` if PDFium accepted the JPEG.
   */
  loadIntoObject(
    api: ImagesToPdfPdfiumApi,
    page: number,
    object: number,
    dataPtr: number,
    byteLength: number,
  ): boolean {
    return api.EPDFImageObj_SetJpeg(page, 0, object, dataPtr, byteLength);
  }
}

/**
 * Query PDFium for an image object's decoded pixel dimensions.
 *
 * Why this check is mandatory: `EPDFImageObj_SetPng` and `EPDFImageObj_SetJpeg`
 * return `true` even when handed truncated or corrupted files. PDFium only
 * discovers the corruption when asked for pixel dimensions, returning `false`
 * or `0 x 0`. Checking here guarantees we never silently emit blank pages.
 *
 * @param api PDFium bindings.
 * @param heap WASM memory helper.
 * @param object Loaded image object handle.
 * @returns Decoded `{ width, height }` if both are > 0, otherwise `null`.
 */
export function readDecodedImageSize(
  api: ImagesToPdfPdfiumApi,
  heap: WasmHeap,
  object: number,
): Size | null {
  // Allocate 8 bytes on the WASM heap for two 32-bit unsigned ints (width, height).
  return heap.using(heap.alloc(8), (ptr) => {
    if (!api.FPDFImageObj_GetImagePixelSize(object, ptr, ptr + 4)) return null;
    const [width, height] = heap.readInts(ptr, 2);
    return width > 0 && height > 0 ? { width, height } : null;
  });
}

/**
 * Composite {@link ImageEmbedder} that dispatches to a list of
 * {@link ImageEmbedStrategy} implementations and validates decoded dimensions.
 */
export class CompositeImageEmbedder implements ImageEmbedder {
  /**
   * @param strategies Format-specific strategies (defaults to PNG + JPEG).
   */
  constructor(
    private readonly strategies: readonly ImageEmbedStrategy[] = [
      new PngEmbedStrategy(),
      new JpegEmbedStrategy(),
    ],
  ) {}

  /**
   * Embed `bytes` into `object` using the first matching strategy and verify
   * that PDFium decoded non-zero pixel dimensions.
   *
   * Memory safety: `heap.copyIn(bytes)` allocates a temporary WASM buffer that
   * is guaranteed to be freed by `heap.using(...)` immediately after the
   * PDFium loader returns (PDFium copies the image data internally).
   *
   * @param api PDFium bindings.
   * @param heap WASM memory helper.
   * @param page Target page handle.
   * @param object Newly created image object handle.
   * @param mime Image MIME type.
   * @param bytes Raw image bytes.
   * @returns Verified decoded pixel dimensions.
   * @throws {InvalidImageError} When unsupported, empty, or undecodable.
   */
  embed(
    api: ImagesToPdfPdfiumApi,
    heap: WasmHeap,
    page: number,
    object: number,
    mime: ImageMime,
    bytes: Uint8Array,
  ): Size {
    const strategy = this.strategies.find((s) => s.supports(mime));
    if (!strategy) {
      throw new InvalidImageError(`Unsupported image format: ${mime}`);
    }
    if (bytes.length === 0) {
      throw new InvalidImageError(UNREADABLE_IMAGE_MESSAGE);
    }

    const loaded = heap.using(heap.copyIn(bytes), (ptr) =>
      strategy.loadIntoObject(api, page, object, ptr, bytes.length),
    );
    if (!loaded) {
      throw new InvalidImageError(UNREADABLE_IMAGE_MESSAGE);
    }

    const decoded = readDecodedImageSize(api, heap, object);
    if (!decoded) {
      throw new InvalidImageError(UNREADABLE_IMAGE_MESSAGE);
    }
    return decoded;
  }
}
