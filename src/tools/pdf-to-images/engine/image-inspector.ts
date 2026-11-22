import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import {
  COLORSPACE,
  iccDataColourSpace,
  type ImageEncodingInfo,
} from "../core/jpeg-passthrough";
import { METADATA, type ImagesPdfiumApi } from "./pdfium-api";

/** Everything known about one image object before it is decoded. */
export interface EmbeddedImage extends ImageEncodingInfo {
  /** The `FPDF_PAGEOBJECT` handle (valid while its page is loaded). */
  object: number;
  /** Size in pixels, as stored (not as drawn on the page). */
  width: number;
  height: number;
  /** The stream's bytes before any filter is applied. */
  raw: Uint8Array;
}

/**
 * Reads an image object's properties through PDFium, without decoding its
 * pixels. Every buffer it allocates is freed before a method returns.
 */
export class PdfiumImageInspector {
  /**
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   */
  constructor(
    private readonly api: ImagesPdfiumApi,
    private readonly heap: WasmHeap,
  ) {}

  /**
   * Collect an image's size, filters, colour space and raw bytes.
   *
   * @param page The loaded page holding the image (PDFium needs it to
   *   resolve the colour space from the page resources).
   * @param object The image object.
   * @returns The image, or null if PDFium cannot tell its size (no image
   *   data at all, or an empty image).
   */
  inspect(page: number, object: number): EmbeddedImage | null {
    const size = this.pixelSize(object);
    if (!size) return null;
    const colorspace = this.colorspace(page, object);
    return {
      object,
      ...size,
      filters: this.filters(object),
      colorspace,
      iccColourSpace:
        colorspace === COLORSPACE.ICC_BASED
          ? this.iccColourSpace(page, object)
          : null,
      raw: this.rawData(object),
    };
  }

  /**
   * The stored size in pixels.
   *
   * @param object The image object.
   * @returns Width and height, or null if unknown or zero.
   */
  pixelSize(object: number): { width: number; height: number } | null {
    return this.heap.using(this.heap.alloc(8), (ptr) => {
      if (!this.api.FPDFImageObj_GetImagePixelSize(object, ptr, ptr + 4)) {
        return null;
      }
      // Two C `unsigned int`s; ">>> 0" reads them as unsigned.
      const [width, height] = this.heap.readInts(ptr, 2).map((v) => v >>> 0);
      return width > 0 && height > 0 ? { width, height } : null;
    });
  }

  /**
   * The names of the stream's filters, in the order they are applied.
   *
   * @param object The image object.
   * @returns For example ["DCTDecode"]; empty for an unfiltered stream.
   */
  filters(object: number): string[] {
    const count = this.api.FPDFImageObj_GetImageFilterCount(object);
    return Array.from({ length: Math.max(0, count) }, (_, index) =>
      this.heap.readString(
        (buffer, length) =>
          this.api.FPDFImageObj_GetImageFilter(object, index, buffer, length),
        "utf8",
      ),
    );
  }

  /**
   * The family of the image's colour space, from `FPDF_IMAGEOBJ_METADATA`.
   *
   * @param page The loaded page holding the image.
   * @param object The image object.
   * @returns One of `COLORSPACE` (UNKNOWN when PDFium cannot tell).
   */
  colorspace(page: number, object: number): number {
    return this.heap.using(this.heap.alloc(METADATA.SIZE), (ptr) => {
      if (!this.api.FPDFImageObj_GetImageMetadata(object, page, ptr)) {
        return COLORSPACE.UNKNOWN;
      }
      return this.heap.readInts(ptr + METADATA.COLORSPACE_OFFSET, 1)[0];
    });
  }

  /**
   * The data colour space named in the image's ICC profile header.
   *
   * Two calls: the first (no buffer) reports the profile's size, the second
   * copies the profile into a block of that size.
   *
   * @param page The loaded page holding the image.
   * @param object The image object.
   * @returns For example "RGB " or "GRAY", or null without a profile.
   */
  iccColourSpace(page: number, object: number): string | null {
    const length = this.heap.using(this.heap.alloc(4), (lengthPtr) =>
      this.api.FPDFImageObj_GetIccProfileDataDecoded(
        object,
        page,
        0,
        0,
        lengthPtr,
      )
        ? this.heap.readInts(lengthPtr, 1)[0] >>> 0
        : 0,
    );
    if (length === 0) return null;
    return this.heap.using(this.heap.alloc(length + 4), (buffer) => {
      const lengthPtr = buffer + length;
      if (
        !this.api.FPDFImageObj_GetIccProfileDataDecoded(
          object,
          page,
          buffer,
          length,
          lengthPtr,
        )
      ) {
        return null;
      }
      return iccDataColourSpace(this.heap.copyOut(buffer, length));
    });
  }

  /**
   * The stream's bytes exactly as stored in the file (for a JPEG image,
   * the JPEG file itself).
   *
   * @param object The image object.
   * @returns A copy of the raw bytes (empty if the stream has none).
   */
  rawData(object: number): Uint8Array {
    const length = this.api.FPDFImageObj_GetImageDataRaw(object, 0, 0);
    if (length <= 0) return new Uint8Array(0);
    return this.heap.using(this.heap.alloc(length), (buffer) => {
      this.api.FPDFImageObj_GetImageDataRaw(object, buffer, length);
      return this.heap.copyOut(buffer, length);
    });
  }
}
