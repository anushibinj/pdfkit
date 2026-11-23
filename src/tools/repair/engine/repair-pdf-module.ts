/**
 * Low-level WebAssembly bridge for the pdf-repair module (`crates/pdf-repair`).
 *
 * Implements Interface Segregation Principle (ISP) and Single Responsibility Principle (SRP)
 * by managing WebAssembly linear memory allocations and raw C FFI calls without coupling
 * to higher-level document orchestration.
 */

/** Raw exports exposed by the compiled `pdf-repair.wasm` module. */
export interface PdfRepairExports {
  memory: WebAssembly.Memory;
  pdfrepair_abi_version(): number;
  pdfrepair_alloc(length: number): number;
  pdfrepair_free(pointer: number, length: number): void;
  pdfrepair_run(pdf: number, pdfLength: number): number;
  pdfrepair_result_ptr(): number;
  pdfrepair_result_len(): number;
  pdfrepair_report_ptr(): number;
  pdfrepair_report_len(): number;
  pdfrepair_clear(): void;
}

/** The interface version expected by this client. */
export const ABI_VERSION = 1;

/** Return status code indicating successful repair. */
const STATUS_OK = 0;

/** The result of a low-level WebAssembly repair invocation. */
export type RepairModuleOutcome =
  | {
      ok: true;
      /** Rebuilt PDF bytes. */
      pdf: Uint8Array;
      /** Raw JSON repair report string. */
      report: string;
    }
  | {
      ok: false;
      /** Stable error code string (e.g. "invalid-pdf", "encrypted"). */
      code: string;
      /** Human-readable explanation of error. */
      message: string;
    };

/** Function signature for fetching WebAssembly binary bytes. */
export type BytesLoader = (url: string) => Promise<ArrayBuffer>;

/**
 * Encapsulates the instantiated `pdf-repair` WebAssembly module.
 */
export class PdfRepairModule {
  /**
   * Initializes the wrapper over verified WebAssembly exports.
   *
   * @param exports The module exports. Use {@link PdfRepairModule.load}.
   */
  constructor(private readonly exports: PdfRepairExports) {}

  /**
   * Downloads, compiles, and verifies the `pdf-repair` WebAssembly module.
   *
   * Compiles using `WebAssembly.instantiate` rather than streaming to avoid
   * MIME type incompatibilities across static hosts.
   *
   * @param url Absolute or origin-relative URL to the `.wasm` file.
   * @param loadBytes Injected loader function fetching binary bytes.
   * @returns An instantiated, verified {@link PdfRepairModule}.
   * @throws When the binary's ABI version does not match {@link ABI_VERSION}.
   */
  static async load(
    url: string,
    loadBytes: BytesLoader,
  ): Promise<PdfRepairModule> {
    const bytes = await loadBytes(url);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const exports = instance.exports as unknown as PdfRepairExports;

    const version = exports.pdfrepair_abi_version();
    if (version !== ABI_VERSION) {
      throw new Error(
        `The PDF repair engine is version ${version}, expected ${ABI_VERSION}. Please reload the page.`,
      );
    }

    return new PdfRepairModule(exports);
  }

  /**
   * Repairs a damaged PDF buffer through the WebAssembly memory boundary.
   *
   * Lifecycle:
   * 1. Reserves memory in WebAssembly heap via `pdfrepair_alloc`.
   * 2. Copies input bytes into WebAssembly memory.
   * 3. Calls `pdfrepair_run`.
   * 4. Copies the output PDF (or error JSON) and report JSON out of heap.
   * 5. Cleans up input buffer and cached results in `finally` blocks.
   *
   * @param pdf The damaged PDF bytes.
   * @returns The repair outcome containing repaired PDF bytes and report, or error details.
   * @throws {RangeError} When the WebAssembly instance fails to allocate memory.
   */
  repair(pdf: Uint8Array): RepairModuleOutcome {
    const x = this.exports;
    const pdfPtr = this.copyIn(pdf);

    try {
      const status = x.pdfrepair_run(pdfPtr, pdf.length);
      const result = this.copyOut(
        x.pdfrepair_result_ptr(),
        x.pdfrepair_result_len(),
      );

      if (status === STATUS_OK) {
        const reportBytes = this.copyOut(
          x.pdfrepair_report_ptr(),
          x.pdfrepair_report_len(),
        );
        return {
          ok: true,
          pdf: result,
          report: new TextDecoder().decode(reportBytes),
        };
      }

      return {
        ok: false,
        ...parseError(new TextDecoder().decode(result)),
      };
    } finally {
      x.pdfrepair_free(pdfPtr, pdf.length);
      x.pdfrepair_clear();
    }
  }

  /**
   * Copies a byte slice into a newly allocated block in WebAssembly memory.
   *
   * @param bytes Data to transfer into WASM memory.
   * @returns Linear memory address of the allocated block.
   * @throws {RangeError} If the module cannot allocate sufficient memory.
   */
  private copyIn(bytes: Uint8Array): number {
    const ptr = this.exports.pdfrepair_alloc(bytes.length);
    if (!ptr && bytes.length > 0) {
      throw new RangeError("Out of memory: PDF repair engine cannot allocate buffer");
    }
    new Uint8Array(this.exports.memory.buffer).set(bytes, ptr);
    return ptr;
  }

  /**
   * Copies bytes out of WebAssembly memory into an independent JavaScript Uint8Array.
   *
   * Uses `.slice()` to guarantee data validity even if WASM memory grows or reallocates later.
   *
   * @param ptr Start pointer address in WASM memory.
   * @param length Number of bytes to copy.
   * @returns Standalone owned Uint8Array copy.
   */
  private copyOut(ptr: number, length: number): Uint8Array {
    return new Uint8Array(this.exports.memory.buffer).slice(ptr, ptr + length);
  }
}

/**
 * Parses error JSON emitted by the WASM module on failure.
 *
 * @param json The JSON error string.
 * @returns Code and error message.
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
    // Malformed JSON falls back
  }
  return { code: "unknown", message: "The PDF repair engine failed." };
}
