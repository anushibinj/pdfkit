/**
 * The pdf-crop WebAssembly module (`crates/pdf-crop`, served as
 * `/wasm/pdf-crop.wasm`). It has no imports and exports plain C functions
 * over its linear memory; see `crates/pdf-crop/src/ffi.rs`.
 */

/** The module's exports. */
export interface PdfCropExports {
  memory: WebAssembly.Memory;
  pdfcrop_abi_version(): number;
  pdfcrop_alloc(length: number): number;
  pdfcrop_free(pointer: number, length: number): void;
  pdfcrop_run(
    pdf: number,
    pdfLength: number,
    plan: number,
    planLength: number,
  ): number;
  pdfcrop_result_ptr(): number;
  pdfcrop_result_len(): number;
  pdfcrop_report_ptr(): number;
  pdfcrop_report_len(): number;
  pdfcrop_clear(): void;
}

/** The interface version this code speaks (`ABI_VERSION` in ffi.rs). */
export const ABI_VERSION = 1;
/** `pdfcrop_run` succeeded. */
const STATUS_OK = 0;

/** What one crop produced. */
export type CropModuleOutcome =
  | {
      ok: true;
      /** The cropped PDF. */
      pdf: Uint8Array;
      /** The report, as JSON text (see `parseCropReport`). */
      report: string;
    }
  | {
      ok: false;
      /** A stable code, e.g. "encrypted" (see `error.rs`). */
      code: string;
      message: string;
    };

/** Fetches a file's bytes (the worker passes `fetch`; tests read files). */
export type BytesLoader = (url: string) => Promise<ArrayBuffer>;

/** A loaded pdf-crop module. */
export class PdfCropModule {
  /** @param exports The instance's exports. Use {@link PdfCropModule.load}. */
  constructor(private readonly exports: PdfCropExports) {}

  /**
   * Download and instantiate the module.
   *
   * The binary is fetched as bytes and compiled with
   * `WebAssembly.instantiate` rather than `instantiateStreaming`, which
   * needs the server to send `application/wasm`; the site's CSP allows
   * compiling with `'wasm-unsafe-eval'`.
   *
   * @param url Where the binary is served.
   * @param loadBytes Fetches it.
   * @returns The module.
   * @throws When the binary speaks another interface version (a stale
   *   cached copy, say), rather than calling functions that changed.
   */
  static async load(
    url: string,
    loadBytes: BytesLoader,
  ): Promise<PdfCropModule> {
    const { instance } = await WebAssembly.instantiate(
      await loadBytes(url),
      {},
    );
    const exports = instance.exports as unknown as PdfCropExports;
    const version = exports.pdfcrop_abi_version();
    if (version !== ABI_VERSION) {
      throw new Error(
        `The PDF cropping engine is version ${version}, expected ${ABI_VERSION}. Reload the page.`,
      );
    }
    return new PdfCropModule(exports);
  }

  /**
   * Crop a PDF.
   *
   * Steps: reserve module memory for the file and the plan and copy them
   * in; run; copy the result (and report) out; then release the inputs and
   * the module's copy of the result, whatever happens. Memory views are
   * taken fresh after each call that can allocate, because growing the
   * memory replaces its buffer.
   *
   * @param pdf The PDF file.
   * @param plan The encoded plan (see `encodeCropPlan`).
   * @returns The cropped file and report, or the module's error.
   * @throws {RangeError} When the module cannot get memory for the input.
   */
  crop(pdf: Uint8Array, plan: Uint8Array): CropModuleOutcome {
    const x = this.exports;
    const pdfPtr = this.copyIn(pdf);
    try {
      const planPtr = this.copyIn(plan);
      try {
        const status = x.pdfcrop_run(pdfPtr, pdf.length, planPtr, plan.length);
        const result = this.copyOut(
          x.pdfcrop_result_ptr(),
          x.pdfcrop_result_len(),
        );
        if (status === STATUS_OK) {
          const report = this.copyOut(
            x.pdfcrop_report_ptr(),
            x.pdfcrop_report_len(),
          );
          return {
            ok: true,
            pdf: result,
            report: new TextDecoder().decode(report),
          };
        }
        return { ok: false, ...parseError(new TextDecoder().decode(result)) };
      } finally {
        x.pdfcrop_free(planPtr, plan.length);
      }
    } finally {
      x.pdfcrop_free(pdfPtr, pdf.length);
      x.pdfcrop_clear();
    }
  }

  /**
   * Copy bytes into new module memory.
   *
   * @param bytes The data.
   * @returns Its address (the caller frees it).
   * @throws {RangeError} When the module returns a null pointer.
   */
  private copyIn(bytes: Uint8Array): number {
    const ptr = this.exports.pdfcrop_alloc(bytes.length);
    if (!ptr)
      throw new RangeError("out of memory: the PDF cropping engine is full");
    new Uint8Array(this.exports.memory.buffer).set(bytes, ptr);
    return ptr;
  }

  /**
   * Copy bytes out of module memory into a new array (`slice`, so it stays
   * valid after the module frees or grows its memory).
   *
   * @param ptr Start address.
   * @param length Number of bytes.
   * @returns The copy.
   */
  private copyOut(ptr: number, length: number): Uint8Array {
    return new Uint8Array(this.exports.memory.buffer).slice(ptr, ptr + length);
  }
}

/**
 * Read the module's error JSON, `{"code": ..., "message": ...}`.
 *
 * @param json The text.
 * @returns The code and message; unreadable text gives code "unknown".
 */
export function parseError(json: string): { code: string; message: string } {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value === "object" && value !== null) {
      const { code, message } = value as Record<string, unknown>;
      if (typeof code === "string" && typeof message === "string") {
        return { code, message };
      }
    }
  } catch {
    // Fall through.
  }
  return { code: "unknown", message: "The PDF cropping engine failed." };
}
