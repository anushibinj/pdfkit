/**
 * Low-level WebAssembly FFI bridge for the `pdf-ocr` module (`crates/pdf-ocr`).
 *
 * Follows Single Responsibility Principle (SRP) and Interface Segregation Principle (ISP)
 * by isolating linear memory transfers and C ABI invocations from Tesseract, PDFium,
 * and qpdf orchestration.
 */

/** Raw C ABI exports exposed by `pdf-ocr.wasm`. */
export interface PdfOcrExports {
  memory: WebAssembly.Memory;
  pdfocr_abi_version(): number;
  pdfocr_alloc(length: number): number;
  pdfocr_free(pointer: number, length: number): void;
  pdfocr_gunzip(dataPtr: number, dataLength: number): number;
  pdfocr_preprocess_bmp(
    rgbaPtr: number,
    rgbaLength: number,
    width: number,
    height: number,
    dpiX: number,
    dpiY: number,
    enhance: number,
  ): number;
  pdfocr_normalize_overlay(
    pdfPtr: number,
    pdfLength: number,
    targetWidthPt: number,
    targetHeightPt: number,
  ): number;
  pdfocr_build_text_layer(
    tsvPtr: number,
    tsvLength: number,
    targetWidthPt: number,
    targetHeightPt: number,
    imageWidthPx: number,
    imageHeightPx: number,
  ): number;
  pdfocr_result_ptr(): number;
  pdfocr_result_len(): number;
  pdfocr_clear(): void;
}

/** Expected ABI contract version matching `crates/pdf-ocr/src/ffi.rs`. */
export const ABI_VERSION = 1;

/** Return code indicating success from `pdfocr_*` entry points. */
const STATUS_OK = 0;

/** Function signature for fetching raw WebAssembly bytes. */
export type BytesLoader = (url: string) => Promise<ArrayBuffer>;

/**
 * Narrow interface consumed by {@link TesseractWasmRecognizer} and {@link OcrSession}
 * (Dependency Inversion Principle).
 */
export interface OcrHelperModule {
  gunzip(bytes: Uint8Array): Uint8Array;
  preprocessBmp(
    rgba: Uint8Array,
    width: number,
    height: number,
    dpiX: number,
    dpiY: number,
    enhance: boolean,
  ): Uint8Array;
  normalizeOverlay(
    pdfBytes: Uint8Array,
    targetWidthPt: number,
    targetHeightPt: number,
  ): Uint8Array;
  buildTextLayer(
    tsv: string,
    targetWidthPt: number,
    targetHeightPt: number,
    imageWidthPx: number,
    imageHeightPx: number,
  ): Uint8Array;
}

/**
 * Encapsulates an instantiated `pdf-ocr` WebAssembly module.
 */
export class PdfOcrModule implements OcrHelperModule {
  /**
   * @param exports Verified WebAssembly exports. Use {@link PdfOcrModule.load}.
   */
  constructor(private readonly exports: PdfOcrExports) {}

  /**
   * Loads, instantiates, and ABI-verifies `pdf-ocr.wasm`.
   *
   * Uses `WebAssembly.instantiate` on raw `ArrayBuffer` bytes rather than
   * `instantiateStreaming` so static hosts without `application/wasm` MIME
   * headers work seamlessly.
   *
   * @param url Origin-relative or absolute URL to `pdf-ocr.wasm`.
   * @param loadBytes Injected binary fetcher.
   * @returns Ready {@link PdfOcrModule}.
   * @throws When the module's ABI version does not match {@link ABI_VERSION}.
   */
  static async load(
    url: string,
    loadBytes: BytesLoader,
  ): Promise<PdfOcrModule> {
    const bytes = await loadBytes(url);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const exports = instance.exports as unknown as PdfOcrExports;

    const version = exports.pdfocr_abi_version();
    if (version !== ABI_VERSION) {
      throw new Error(
        `The PDF OCR helper engine is version ${version}, expected ${ABI_VERSION}. Please reload the page.`,
      );
    }

    return new PdfOcrModule(exports);
  }

  /**
   * Decompresses a gzip-compressed `.traineddata.gz` buffer (or returns raw bytes unchanged).
   *
   * @param bytes Input bytes.
   * @returns Decompressed `.traineddata` bytes.
   * @throws When the gzip stream is empty or invalid.
   */
  gunzip(bytes: Uint8Array): Uint8Array {
    return this.invokeWithInput(bytes, (ptr, len) =>
      this.exports.pdfocr_gunzip(ptr, len),
    );
  }

  /**
   * Optionally enhances scan contrast and encodes RGBA pixels into a 24-bit
   * bottom-up BMP with physical DPI headers (`biXPelsPerMeter`, `biYPelsPerMeter`).
   *
   * @param rgba Row-major RGBA pixels.
   * @param width Image width in pixels.
   * @param height Image height in pixels.
   * @param dpiX Horizontal DPI.
   * @param dpiY Vertical DPI.
   * @param enhance True to stretch luminance contrast on faded scans.
   * @returns 24-bit BMP file bytes.
   */
  preprocessBmp(
    rgba: Uint8Array,
    width: number,
    height: number,
    dpiX: number,
    dpiY: number,
    enhance: boolean,
  ): Uint8Array {
    return this.invokeWithInput(rgba, (ptr, len) =>
      this.exports.pdfocr_preprocess_bmp(
        ptr,
        len,
        width,
        height,
        dpiX,
        dpiY,
        enhance ? 1 : 0,
      ),
    );
  }

  /**
   * Normalizes a 1-page overlay PDF's `/MediaBox` and coordinate transform to
   * `[0, 0, targetWidthPt, targetHeightPt]` so `qpdf --overlay` aligns 1:1.
   *
   * @param pdfBytes 1-page overlay PDF bytes.
   * @param targetWidthPt Destination displayed width in PDF points.
   * @param targetHeightPt Destination displayed height in PDF points.
   * @returns Normalized 1-page overlay PDF bytes.
   */
  normalizeOverlay(
    pdfBytes: Uint8Array,
    targetWidthPt: number,
    targetHeightPt: number,
  ): Uint8Array {
    return this.invokeWithInput(pdfBytes, (ptr, len) =>
      this.exports.pdfocr_normalize_overlay(
        ptr,
        len,
        targetWidthPt,
        targetHeightPt,
      ),
    );
  }

  /**
   * Builds a 1-page invisible Unicode text-layer PDF (`3 Tr`) directly from
   * Tesseract TSV word bounding boxes as a resilient fallback.
   *
   * @param tsv UTF-8 TSV text emitted by Tesseract.
   * @param targetWidthPt Destination displayed width in PDF points.
   * @param targetHeightPt Destination displayed height in PDF points.
   * @param imageWidthPx Source image width in pixels.
   * @param imageHeightPx Source image height in pixels.
   * @returns 1-page searchable text-only PDF bytes.
   */
  buildTextLayer(
    tsv: string,
    targetWidthPt: number,
    targetHeightPt: number,
    imageWidthPx: number,
    imageHeightPx: number,
  ): Uint8Array {
    const tsvBytes = new TextEncoder().encode(tsv);
    return this.invokeWithInput(tsvBytes, (ptr, len) =>
      this.exports.pdfocr_build_text_layer(
        ptr,
        len,
        targetWidthPt,
        targetHeightPt,
        imageWidthPx,
        imageHeightPx,
      ),
    );
  }

  /**
   * Transfers `input` to WASM linear memory, invokes `fn`, copies out the result
   * (or throws parsed JSON error), and releases temporary WASM allocations.
   */
  private invokeWithInput(
    input: Uint8Array,
    fn: (ptr: number, len: number) => number,
  ): Uint8Array {
    const x = this.exports;
    const ptr = input.length > 0 ? this.copyIn(input) : 0;

    try {
      const status = fn(ptr, input.length);
      const out = this.copyOut(x.pdfocr_result_ptr(), x.pdfocr_result_len());

      if (status !== STATUS_OK) {
        const err = parseOcrWasmError(new TextDecoder().decode(out));
        throw new Error(err.message);
      }

      return out;
    } finally {
      if (ptr !== 0) {
        x.pdfocr_free(ptr, input.length);
      }
      x.pdfocr_clear();
    }
  }

  /** Allocates linear memory and copies `bytes` into it. */
  private copyIn(bytes: Uint8Array): number {
    const ptr = this.exports.pdfocr_alloc(bytes.length);
    if (!ptr && bytes.length > 0) {
      throw new RangeError(
        "Out of memory: PDF OCR helper cannot allocate buffer.",
      );
    }
    if (bytes.length > 0) {
      new Uint8Array(this.exports.memory.buffer).set(bytes, ptr);
    }
    return ptr;
  }

  /** Copies `length` bytes from linear memory into a standalone `Uint8Array`. */
  private copyOut(ptr: number, length: number): Uint8Array {
    if (length === 0) return new Uint8Array(0);
    return new Uint8Array(this.exports.memory.buffer).slice(ptr, ptr + length);
  }
}

/**
 * Parses an error JSON payload emitted by `pdf-ocr.wasm`.
 *
 * @param json JSON string.
 * @returns `{ code, message }` with safe defaults.
 */
export function parseOcrWasmError(json: string): {
  code: string;
  message: string;
} {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value === "object" && value !== null) {
      const { code, message } = value as Record<string, unknown>;
      if (typeof code === "string" && typeof message === "string") {
        return { code, message };
      }
    }
  } catch {
    // Fallback below
  }
  return { code: "unknown", message: "The PDF OCR helper engine failed." };
}
