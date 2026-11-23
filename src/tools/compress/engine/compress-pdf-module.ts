/**
 * Low-level WebAssembly FFI bridge for the `pdf-compress` module (`crates/pdf-compress`).
 *
 * Follows Single Responsibility Principle (SRP) and Interface Segregation Principle (ISP)
 * by isolating linear memory transfers and C ABI invocations from higher-level
 * orchestration (qpdf, PDFium, target-size solver).
 */

/** Raw C ABI exports exposed by `pdf-compress.wasm`. */
export interface PdfCompressExports {
  memory: WebAssembly.Memory;
  pdfcompress_abi_version(): number;
  pdfcompress_alloc(length: number): number;
  pdfcompress_free(pointer: number, length: number): void;
  pdfcompress_run(
    pdfPtr: number,
    pdfLength: number,
    planPtr: number,
    planLength: number,
  ): number;
  pdfcompress_encode_jpeg(
    rgbaPtr: number,
    rgbaLength: number,
    width: number,
    height: number,
    targetWidth: number,
    targetHeight: number,
    quality: number,
    grayscale: number,
  ): number;
  pdfcompress_result_ptr(): number;
  pdfcompress_result_len(): number;
  pdfcompress_report_ptr(): number;
  pdfcompress_report_len(): number;
  pdfcompress_clear(): void;
}

/** Expected ABI contract version matching `crates/pdf-compress/src/ffi.rs`. */
export const ABI_VERSION = 1;

/** Return code indicating success from `pdfcompress_run` / `pdfcompress_encode_jpeg`. */
const STATUS_OK = 0;

/** Result of invoking `pdfcompress_run`. */
export type CompressModuleOutcome =
  | {
      ok: true;
      /** Compressed PDF bytes. */
      pdf: Uint8Array;
      /** Raw JSON telemetry report string. */
      report: string;
    }
  | {
      ok: false;
      /** Machine-readable error code (`"empty-input"`, `"invalid-pdf"`, `"encrypted"`, etc.). */
      code: string;
      /** Human-readable error message. */
      message: string;
    };

/** Function signature for fetching raw WebAssembly bytes. */
export type BytesLoader = (url: string) => Promise<ArrayBuffer>;

/**
 * Encapsulates an instantiated `pdf-compress` WebAssembly module.
 */
export class PdfCompressModule {
  /**
   * @param exports Verified WebAssembly exports. Use {@link PdfCompressModule.load}.
   */
  constructor(private readonly exports: PdfCompressExports) {}

  /**
   * Loads, instantiates, and ABI-verifies `pdf-compress.wasm`.
   *
   * Uses `WebAssembly.instantiate` on raw `ArrayBuffer` bytes rather than
   * `instantiateStreaming` to remain compatible with static hosts lacking
   * `application/wasm` MIME headers.
   *
   * @param url Origin-relative or absolute URL to `pdf-compress.wasm`.
   * @param loadBytes Injected binary fetcher.
   * @returns Ready {@link PdfCompressModule}.
   * @throws When the module's ABI version does not match {@link ABI_VERSION}.
   */
  static async load(
    url: string,
    loadBytes: BytesLoader,
  ): Promise<PdfCompressModule> {
    const bytes = await loadBytes(url);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const exports = instance.exports as unknown as PdfCompressExports;

    const version = exports.pdfcompress_abi_version();
    if (version !== ABI_VERSION) {
      throw new Error(
        `The PDF compression engine is version ${version}, expected ${ABI_VERSION}. Please reload the page.`,
      );
    }

    return new PdfCompressModule(exports);
  }

  /**
   * Executes structural and image PDF compression inside WebAssembly memory.
   *
   * @param pdf Raw PDF bytes.
   * @param planBytes Serialized `PCMP` compression plan (empty uses lossless defaults).
   * @returns Compressed PDF bytes + JSON report, or structured error details.
   */
  compress(
    pdf: Uint8Array,
    planBytes: Uint8Array = new Uint8Array(0),
  ): CompressModuleOutcome {
    const x = this.exports;
    const pdfPtr = this.copyIn(pdf);
    const planPtr = planBytes.length > 0 ? this.copyIn(planBytes) : 0;

    try {
      const status = x.pdfcompress_run(
        pdfPtr,
        pdf.length,
        planPtr,
        planBytes.length,
      );
      const result = this.copyOut(
        x.pdfcompress_result_ptr(),
        x.pdfcompress_result_len(),
      );

      if (status === STATUS_OK) {
        const reportBytes = this.copyOut(
          x.pdfcompress_report_ptr(),
          x.pdfcompress_report_len(),
        );
        return {
          ok: true,
          pdf: result,
          report: new TextDecoder().decode(reportBytes),
        };
      }

      return {
        ok: false,
        ...parseCompressError(new TextDecoder().decode(result)),
      };
    } finally {
      x.pdfcompress_free(pdfPtr, pdf.length);
      if (planPtr !== 0) {
        x.pdfcompress_free(planPtr, planBytes.length);
      }
      x.pdfcompress_clear();
    }
  }

  /**
   * Downsamples an RGBA buffer (area-averaged) and encodes a baseline DCT JPEG
   * using the Rust encoder inside `pdf-compress.wasm`.
   *
   * Useful both in Node integration tests (where `OffscreenCanvas` is absent)
   * and as a deterministic fallback when browser canvas JPEG encoding is unavailable.
   *
   * @param rgba Source RGBA pixel buffer.
   * @param width Source width in pixels.
   * @param height Source height in pixels.
   * @param targetWidth Target width in pixels.
   * @param targetHeight Target height in pixels.
   * @param quality Quality fraction `[0.1, 1.0]`.
   * @param grayscale When true, encodes 1-channel DeviceGray JPEG.
   * @returns Encoded baseline JPEG bytes.
   * @throws When the WASM encoder rejects the dimensions or buffer.
   */
  encodeJpeg(
    rgba: Uint8Array,
    width: number,
    height: number,
    targetWidth: number,
    targetHeight: number,
    quality: number,
    grayscale: boolean,
  ): Uint8Array {
    const x = this.exports;
    const rgbaPtr = this.copyIn(rgba);
    const qInt = Math.min(100, Math.max(1, Math.round(quality * 100)));

    try {
      const status = x.pdfcompress_encode_jpeg(
        rgbaPtr,
        rgba.length,
        width,
        height,
        targetWidth,
        targetHeight,
        qInt,
        grayscale ? 1 : 0,
      );
      const result = this.copyOut(
        x.pdfcompress_result_ptr(),
        x.pdfcompress_result_len(),
      );
      if (status !== STATUS_OK) {
        const err = parseCompressError(new TextDecoder().decode(result));
        throw new Error(err.message);
      }
      return result;
    } finally {
      x.pdfcompress_free(rgbaPtr, rgba.length);
      x.pdfcompress_clear();
    }
  }

  /**
   * Copies bytes into a newly allocated WASM heap slice.
   *
   * @param bytes Bytes to transfer.
   * @returns Linear memory pointer.
   * @throws {RangeError} When WASM allocation fails.
   */
  private copyIn(bytes: Uint8Array): number {
    const ptr = this.exports.pdfcompress_alloc(bytes.length);
    if (!ptr && bytes.length > 0) {
      throw new RangeError(
        "Out of memory: PDF compression engine cannot allocate buffer.",
      );
    }
    if (bytes.length > 0) {
      new Uint8Array(this.exports.memory.buffer).set(bytes, ptr);
    }
    return ptr;
  }

  /**
   * Copies bytes out of WASM memory into an independent `Uint8Array`.
   *
   * @param ptr Linear memory pointer.
   * @param length Byte count.
   * @returns Owned `Uint8Array` copy.
   */
  private copyOut(ptr: number, length: number): Uint8Array {
    if (length === 0) return new Uint8Array(0);
    return new Uint8Array(this.exports.memory.buffer).slice(ptr, ptr + length);
  }
}

/**
 * Parses an error JSON payload emitted by `pdf-compress.wasm`.
 *
 * @param json JSON string.
 * @returns `{ code, message }` with safe fallback values.
 */
export function parseCompressError(json: string): {
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
    // Malformed JSON falls back
  }
  return { code: "unknown", message: "The PDF compression engine failed." };
}
