import type { SanitizeReportMetrics } from "../core/model";

/**
 * The `pdf-redact` WebAssembly module (`crates/pdf-redact`, served as
 * `/wasm/pdf-redact.wasm`). Exports plain C ABI functions over linear memory
 * (`crates/pdf-redact/src/ffi.rs`) with zero host imports.
 */
export interface PdfRedactExports {
  memory: WebAssembly.Memory;
  pdfredact_abi_version(): number;
  pdfredact_alloc(length: number): number;
  pdfredact_free(pointer: number, length: number): void;
  pdfredact_run(
    pdf: number,
    pdfLength: number,
    plan: number,
    planLength: number,
  ): number;
  pdfredact_result_ptr(): number;
  pdfredact_result_len(): number;
  pdfredact_report_ptr(): number;
  pdfredact_report_len(): number;
  pdfredact_clear(): void;
}

/** Interface version matched against `ABI_VERSION` in `crates/pdf-redact/src/ffi.rs`. */
export const ABI_VERSION = 1;
const STATUS_OK = 0;

/** Outcome returned by {@link PdfRedactModule.sanitize}. */
export type SanitizeModuleOutcome =
  | {
      ok: true;
      pdf: Uint8Array;
      report: SanitizeReportMetrics;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

/** Fetches binary bytes from a URL (injected for unit tests). */
export type BytesLoader = (url: string) => Promise<ArrayBuffer>;

/**
 * Abstraction for the `pdf-redact` sanitization module (Dependency Inversion).
 */
export interface RedactSanitizer {
  sanitize(pdf: Uint8Array, encodedPlan: Uint8Array): SanitizeModuleOutcome;
}

/** Thin TypeScript wrapper over the instantiated `pdf_redact.wasm` module. */
export class PdfRedactModule implements RedactSanitizer {
  /** @param exports Raw WASM exports. Use {@link PdfRedactModule.load}. */
  constructor(private readonly exports: PdfRedactExports) {}

  /**
   * Fetch and instantiate `/wasm/pdf-redact.wasm`, verifying its ABI version.
   *
   * @param url URL of the WASM binary.
   * @param loadBytes Byte loader (`fetchBytes` in workers, `fs.readFile` in tests).
   * @returns Instantiated {@link PdfRedactModule}.
   * @throws When the WASM binary reports a mismatched ABI version.
   */
  static async load(
    url: string,
    loadBytes: BytesLoader,
  ): Promise<PdfRedactModule> {
    const { instance } = await WebAssembly.instantiate(
      await loadBytes(url),
      {},
    );
    const exports = instance.exports as unknown as PdfRedactExports;
    const version = exports.pdfredact_abi_version();
    if (version !== ABI_VERSION) {
      throw new Error(
        `The PDF redaction sanitizer is version ${version}, expected ${ABI_VERSION}. Reload the page.`,
      );
    }
    return new PdfRedactModule(exports);
  }

  /**
   * Scrub document-wide metadata, attachments, JavaScript, hidden layers,
   * bookmarks, and overlapping annotations/form values, prune unreachable
   * objects, and rewrite a clean single-revision PDF.
   *
   * @param pdf Input unencrypted PDF bytes.
   * @param encodedPlan Binary plan produced by `encodeSanitizePlan`.
   * @returns Sanitized PDF bytes + metrics, or a structured module error.
   * @throws {RangeError} When WASM memory allocation fails.
   */
  sanitize(pdf: Uint8Array, encodedPlan: Uint8Array): SanitizeModuleOutcome {
    const x = this.exports;
    const pdfPtr = this.copyIn(pdf);
    try {
      const planPtr = this.copyIn(encodedPlan);
      try {
        const status = x.pdfredact_run(
          pdfPtr,
          pdf.length,
          planPtr,
          encodedPlan.length,
        );
        const result = this.copyOut(
          x.pdfredact_result_ptr(),
          x.pdfredact_result_len(),
        );
        if (status === STATUS_OK) {
          const reportBytes = this.copyOut(
            x.pdfredact_report_ptr(),
            x.pdfredact_report_len(),
          );
          return {
            ok: true,
            pdf: result,
            report: parseSanitizeReport(new TextDecoder().decode(reportBytes)),
          };
        }
        return { ok: false, ...parseError(new TextDecoder().decode(result)) };
      } finally {
        x.pdfredact_free(planPtr, encodedPlan.length);
      }
    } finally {
      x.pdfredact_free(pdfPtr, pdf.length);
      x.pdfredact_clear();
    }
  }

  private copyIn(bytes: Uint8Array): number {
    const ptr = this.exports.pdfredact_alloc(bytes.length);
    if (!ptr) {
      throw new RangeError(
        "out of memory: the PDF redaction sanitizer is full",
      );
    }
    new Uint8Array(this.exports.memory.buffer).set(bytes, ptr);
    return ptr;
  }

  private copyOut(ptr: number, length: number): Uint8Array {
    return new Uint8Array(this.exports.memory.buffer).slice(ptr, ptr + length);
  }
}

/**
 * Parse a JSON error payload `{"code": ..., "message": ...}` returned by `pdfredact_run`.
 *
 * @param json Raw UTF-8 string from WASM.
 * @returns Structured code and human-readable message.
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
  return {
    code: "unknown",
    message: "The PDF redaction sanitizer failed.",
  };
}

/**
 * Parse the JSON metrics emitted by `pdf-redact` (`SanitizeReport::to_json`).
 *
 * @param json Raw JSON string from WASM.
 * @returns Typed {@link SanitizeReportMetrics} with safe zero defaults.
 */
export function parseSanitizeReport(json: string): SanitizeReportMetrics {
  const num = (obj: Record<string, unknown>, key: string) =>
    typeof obj[key] === "number" && Number.isFinite(obj[key])
      ? (obj[key] as number)
      : 0;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null) {
      const o = parsed as Record<string, unknown>;
      return {
        metadataEntriesRemoved: num(o, "metadataEntriesRemoved"),
        xmpStreamsRemoved: num(o, "xmpStreamsRemoved"),
        attachmentsRemoved: num(o, "attachmentsRemoved"),
        javascriptActionsRemoved: num(o, "javascriptActionsRemoved"),
        hiddenLayersRemoved: num(o, "hiddenLayersRemoved"),
        bookmarksCleaned: num(o, "bookmarksCleaned"),
        annotationsRemoved: num(o, "annotationsRemoved"),
        formValuesCleared: num(o, "formValuesCleared"),
        objectsPruned: num(o, "objectsPruned"),
      };
    }
  } catch {
    // Fall through to zeroes.
  }
  return {
    metadataEntriesRemoved: 0,
    xmpStreamsRemoved: 0,
    attachmentsRemoved: 0,
    javascriptActionsRemoved: 0,
    hiddenLayersRemoved: 0,
    bookmarksCleaned: 0,
    annotationsRemoved: 0,
    formValuesCleared: 0,
    objectsPruned: 0,
  };
}
