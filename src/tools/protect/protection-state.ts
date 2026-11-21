import type { ProtectResult } from "./messages";

/**
 * Why protecting failed. "crashed" is added on the main thread for a worker
 * that died (the worker itself can only report the other two).
 */
export type ProtectionErrorReason =
  Extract<ProtectResult, { status: "error" }>["reason"] | "crashed";

/** Where protection is, from the UI's point of view. */
export type ProtectionState =
  | { kind: "idle" }
  | { kind: "protecting" }
  | {
      kind: "done";
      pdf: Blob;
      replacedRestrictions: boolean;
      /** Digital signatures the input had; none is valid in `pdf`. */
      invalidatedSignatures: number;
      warnings?: string;
    }
  | { kind: "already-protected" }
  | { kind: "error"; reason: ProtectionErrorReason; message: string };

export type ProtectionAction =
  | { type: "start" }
  | {
      type: "succeed";
      pdf: Blob;
      replacedRestrictions: boolean;
      invalidatedSignatures: number;
      warnings?: string;
    }
  /** The PDF already needs a password; nothing was changed. */
  | { type: "refuse" }
  | { type: "fail"; reason: ProtectionErrorReason; message: string }
  /** The user stopped a running job. */
  | { type: "cancel" }
  /** The password or its confirmation was edited. */
  | { type: "password-changed" }
  /** Another file was chosen, or the file was removed. */
  | { type: "file-changed" };

export const INITIAL_PROTECTION_STATE: ProtectionState = { kind: "idle" };

/**
 * Pure state transitions for the Protect PDF page.
 *
 * Rules, and why:
 * - "start" is ignored while protecting, so a double click never queues a
 *   second job behind the first.
 * - "succeed", "refuse" and "fail" only apply while protecting. A late answer
 *   from a cancelled job must not overwrite what the user sees now.
 * - "cancel" only applies while protecting and returns to idle.
 * - "password-changed" drops a finished PDF (it was encrypted with the old
 *   password; offering it would hand over a file that the password now in
 *   the form does not open) and an error (it may have been about the old
 *   password). "Already protected" is kept: it is about the file, not the
 *   password.
 * - "file-changed" drops every settled result, because all of them describe
 *   the previous file.
 * - Neither change applies while protecting: the form is locked then, and
 *   the running job's result is for the input at the time of the click.
 * Unchanged state is returned as the same object so React can skip renders.
 *
 * @param state Current state.
 * @param action What happened.
 * @returns The next state.
 */
export function protectionReducer(
  state: ProtectionState,
  action: ProtectionAction,
): ProtectionState {
  switch (action.type) {
    case "start":
      return state.kind === "protecting" ? state : { kind: "protecting" };
    case "succeed":
      return state.kind === "protecting"
        ? {
            kind: "done",
            pdf: action.pdf,
            replacedRestrictions: action.replacedRestrictions,
            invalidatedSignatures: action.invalidatedSignatures,
            warnings: action.warnings,
          }
        : state;
    case "refuse":
      return state.kind === "protecting"
        ? { kind: "already-protected" }
        : state;
    case "fail":
      return state.kind === "protecting"
        ? { kind: "error", reason: action.reason, message: action.message }
        : state;
    case "cancel":
      return state.kind === "protecting" ? { kind: "idle" } : state;
    case "password-changed":
      return state.kind === "done" || state.kind === "error"
        ? { kind: "idle" }
        : state;
    case "file-changed":
      return state.kind === "idle" || state.kind === "protecting"
        ? state
        : { kind: "idle" };
  }
}
