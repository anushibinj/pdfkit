/**
 * Verifier ensuring repaired PDF documents can be opened, rendered, and read by readers.
 *
 * Implements Single Responsibility Principle (SRP) by focusing strictly on document
 * validation, and Dependency Inversion Principle (DIP) by accepting a decoupled PDFium API.
 */

import { FPDF_ERR, type PdfiumCoreApi } from "@/lib/pdfium/core-api";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";

/** Verification assessment of a repaired PDF file. */
export type VerificationResult =
  | {
      /** Document opened and verified valid. */
      valid: true;
      /** Number of confirmed pages. */
      pageCount: number;
      /** Clean bytes reserialized through PDFium, if requested. */
      normalizedBytes?: Uint8Array;
    }
  | {
      /** Document could not be opened or verified. */
      valid: false;
      /** Classified reason for invalidity. */
      reason: "password-required" | "corrupt" | "empty";
      /** Detailed explanation. */
      message: string;
    };

/**
 * Validates repaired PDF bytes using the PDFium rendering engine.
 */
export class RepairVerifier {
  private readonly heap: WasmHeap;

  /**
   * @param api The PDFium core API implementation.
   */
  constructor(private readonly api: PdfiumCoreApi) {
    this.heap = new WasmHeap(api.pdfium);
  }

  /**
   * Verifies that `bytes` constitutes a valid, readable PDF document.
   *
   * Steps:
   * 1. Rejects empty byte arrays immediately.
   * 2. Copies bytes into PDFium WebAssembly memory.
   * 3. Attempts document load via `FPDF_LoadMemDocument`.
   * 4. Checks error codes for password protection vs corruption.
   * 5. Confirms at least one page exists and can be loaded.
   * 6. Optionally reserializes via `PDFiumExt_SaveAsCopy` to produce clean normalized output.
   * 7. Always cleans up memory and handles in `finally`.
   *
   * @param bytes PDF bytes to verify.
   * @param password Optional open password if protected.
   * @param reserialize Whether to re-export clean bytes via PDFium.
   * @returns A {@link VerificationResult} stating validity and page count.
   */
  verify(
    bytes: Uint8Array,
    password = "",
    reserialize = false,
  ): VerificationResult {
    if (bytes.length === 0) {
      return {
        valid: false,
        reason: "empty",
        message: "Repaired file is empty.",
      };
    }

    const dataPtr = this.heap.copyIn(bytes);
    try {
      const doc = this.api.FPDF_LoadMemDocument(dataPtr, bytes.length, password);
      if (!doc) {
        const err = this.api.FPDF_GetLastError();
        if (err === FPDF_ERR.PASSWORD) {
          return {
            valid: false,
            reason: "password-required",
            message: "Password required to open this document.",
          };
        }
        return {
          valid: false,
          reason: "corrupt",
          message: "Document is damaged or unreadable by PDFium.",
        };
      }

      try {
        const count = this.api.FPDF_GetPageCount(doc);
        if (count <= 0) {
          return {
            valid: false,
            reason: "corrupt",
            message: "Document contains 0 pages.",
          };
        }

        // Verify that the first page can actually be loaded
        const page = this.api.FPDF_LoadPage(doc, 0);
        if (!page) {
          return {
            valid: false,
            reason: "corrupt",
            message: "Failed to load initial page.",
          };
        }
        this.api.FPDF_ClosePage(page);

        let normalizedBytes: Uint8Array | undefined;
        if (reserialize) {
          const writer = this.api.PDFiumExt_OpenFileWriter();
          if (writer) {
            try {
              if (this.api.PDFiumExt_SaveAsCopy(doc, writer)) {
                const size = this.api.PDFiumExt_GetFileWriterSize(writer);
                if (size > 0) {
                  this.heap.using(this.heap.alloc(size), (bufPtr) => {
                    this.api.PDFiumExt_GetFileWriterData(writer, bufPtr, size);
                    normalizedBytes = this.heap.copyOut(bufPtr, size);
                  });
                }
              }
            } finally {
              this.api.PDFiumExt_CloseFileWriter(writer);
            }
          }
        }

        return {
          valid: true,
          pageCount: count,
          normalizedBytes,
        };
      } finally {
        this.api.FPDF_CloseDocument(doc);
      }
    } finally {
      this.heap.free(dataPtr);
    }
  }
}
