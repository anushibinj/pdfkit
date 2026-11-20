/** Messages between the Protect PDF UI and its Web Worker. */

export interface ProtectRequest {
  /** PDF bytes (transferred, not copied) */
  data: ArrayBuffer;
  /** The password that will be needed to open the PDF */
  password: string;
}

export type ProtectResult =
  | {
      status: "protected";
      /** The encrypted PDF (transferred, not copied) */
      data: ArrayBuffer;
      /** The input's printing/copying/editing restrictions were replaced */
      replacedRestrictions: boolean;
      /** Digital signatures in the input; none of them is valid in `data` */
      invalidatedSignatures: number;
      /** Present when qpdf succeeded with warnings (exit code 3) */
      warnings?: string;
    }
  /** The PDF already needs a password to open; nothing was changed. */
  | { status: "already-protected" }
  | {
      status: "error";
      /** "out-of-memory": the UI should restart the worker to free memory. */
      reason: "out-of-memory" | "failed";
      message: string;
    };
