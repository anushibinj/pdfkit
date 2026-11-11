import type { ConvertResult } from "./messages";

type ErrorReason = Extract<ConvertResult, { status: "error" }>["reason"];

/** Where the converter is, from the UI's point of view. */
export type ConversionState =
  | { kind: "idle" }
  | { kind: "converting" }
  | { kind: "done"; pdf: Blob }
  | { kind: "error"; reason: ErrorReason; message: string };

export type ConversionAction =
  | { type: "start" }
  | { type: "succeed"; pdf: Blob }
  | { type: "fail"; reason: ErrorReason; message: string }
  /** The user stopped a running conversion. */
  | { type: "cancel" }
  /** Markdown, CSS or page settings changed, so any result is out of date. */
  | { type: "input-changed" };

export const INITIAL_CONVERSION_STATE: ConversionState = { kind: "idle" };

/**
 * Pure state transitions for the converter UI.
 *
 * Rules, and why:
 * - "start" is ignored while a conversion is running, so a double click can
 *   never queue a second job behind the first.
 * - "succeed" and "fail" only apply while converting. A late answer from a
 *   cancelled job must not overwrite what the user sees now.
 * - "cancel" only applies while converting and returns to idle.
 * - "input-changed" drops a finished PDF or an error, because both describe
 *   input that no longer exists; offering that PDF for download would hand the
 *   user a document that does not match the editor. A running conversion is
 *   left alone (the result will simply be for the input at the time of the
 *   click).
 * Unchanged state is returned as the same object so React can skip renders.
 *
 * @param state Current state.
 * @param action What happened.
 * @returns The next state.
 */
export function conversionReducer(
  state: ConversionState,
  action: ConversionAction,
): ConversionState {
  switch (action.type) {
    case "start":
      return state.kind === "converting" ? state : { kind: "converting" };
    case "succeed":
      return state.kind === "converting"
        ? { kind: "done", pdf: action.pdf }
        : state;
    case "fail":
      return state.kind === "converting"
        ? { kind: "error", reason: action.reason, message: action.message }
        : state;
    case "cancel":
      return state.kind === "converting" ? { kind: "idle" } : state;
    case "input-changed":
      return state.kind === "done" || state.kind === "error"
        ? { kind: "idle" }
        : state;
  }
}
