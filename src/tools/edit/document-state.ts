import type { PageInfo } from "./core/model";
import type { OpenResult } from "./messages";

/** Where opening a file stands, from the UI's point of view. */
export type DocumentStatus =
  | { kind: "empty" }
  | { kind: "opening"; fileName: string }
  | { kind: "needs-password"; fileName: string; wrong: boolean }
  | { kind: "ready"; fileName: string; pages: PageInfo[] }
  | { kind: "failed"; fileName: string; message: string };

export type DocumentAction =
  /** Started opening `fileName` (first try, or with a password). */
  | { type: "opening"; fileName: string }
  /** The worker answered the open request. */
  | { type: "opened"; result: OpenResult }
  /** Reading the file itself failed before the worker saw it. */
  | { type: "read-failed"; fileName: string; message: string }
  /** The file was closed or the password prompt cancelled. */
  | { type: "reset" };

export const INITIAL_DOCUMENT_STATUS: DocumentStatus = { kind: "empty" };

/**
 * Pure transitions for the document lifecycle.
 *
 * An "opened" answer only counts while a file is being opened. If the user
 * closed the file or picked another one in the meantime, the late answer
 * belongs to a request nobody waits for, and the state is left alone.
 *
 * @param state Current status.
 * @param action What happened.
 * @returns The next status.
 */
export function documentReducer(
  state: DocumentStatus,
  action: DocumentAction,
): DocumentStatus {
  switch (action.type) {
    case "opening":
      return { kind: "opening", fileName: action.fileName };
    case "read-failed":
      return {
        kind: "failed",
        fileName: action.fileName,
        message: action.message,
      };
    case "reset":
      return state.kind === "empty" ? state : INITIAL_DOCUMENT_STATUS;
    case "opened": {
      if (state.kind !== "opening") return state;
      const { fileName } = state;
      const r = action.result;
      switch (r.status) {
        case "opened":
          return { kind: "ready", fileName, pages: r.pages };
        case "password-required":
          return { kind: "needs-password", fileName, wrong: false };
        case "wrong-password":
          return { kind: "needs-password", fileName, wrong: true };
        case "error":
          return { kind: "failed", fileName, message: r.message };
      }
    }
  }
}
