/** Messages between the verify UI and its Web Worker. */

export type SignatureStatus =
  /** Digest and signature both check out. Signer trust was NOT evaluated. */
  | "valid"
  /** Content was altered after signing, or the signature does not match. */
  | "invalid"
  /** Signature format we cannot check (e.g. legacy adbe.x509.rsa_sha1). */
  | "unsupported";

export interface SignatureReport {
  index: number;
  status: SignatureStatus;
  /** Human readable explanation, always set for invalid/unsupported */
  reason?: string;
  /** Signer certificate common name (or full subject), if readable */
  signer?: string;
  /** True when the signed byte ranges cover the whole file. False means
   *  bytes were appended after this signature (often a later signature). */
  coversWholeFile: boolean;
}

export interface VerifyRequest {
  /** PDF bytes (transferred, not copied) */
  data: ArrayBuffer;
}

export type VerifyResult =
  | { status: "no-signatures" }
  | {
      status: "checked";
      signatures: SignatureReport[];
      /** True only when every signature is "valid" */
      allValid: boolean;
      /** Original bytes, handed back so the UI can stamp them without re-reading */
      data: ArrayBuffer;
    }
  | { status: "error"; message: string };

export interface StampRequest {
  data: ArrayBuffer;
  signatureCount: number;
  verifiedAt: string;
}

export type StampResult =
  | { status: "stamped"; data: ArrayBuffer }
  | { status: "error"; message: string };

export type WorkerRequestPayload =
  | ({ op: "verify" } & VerifyRequest)
  | ({ op: "stamp" } & StampRequest);
export type WorkerResultPayload = VerifyResult | StampResult;
