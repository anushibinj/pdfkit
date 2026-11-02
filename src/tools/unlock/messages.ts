/** Messages between the unlock UI and its Web Worker. */

export interface UnlockRequest {
  /** PDF bytes (transferred, not copied) */
  data: ArrayBuffer;
  /** Leave undefined to let the worker detect the encryption state */
  password?: string;
}

export type UnlockResult =
  | { status: "not-encrypted" }
  | {
      status: "unlocked";
      /** "owner": opened freely, restrictions removed. "password": user password was needed. */
      via: "owner" | "password";
      data: ArrayBuffer;
      /** Present when qpdf exited with code 3 (succeeded with warnings) */
      warnings?: string;
    }
  | { status: "password-required" }
  | { status: "wrong-password" }
  | { status: "error"; reason: "out-of-memory" | "failed"; message: string };
