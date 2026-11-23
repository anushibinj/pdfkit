/**
 * State machine and transitions for the Repair PDF user interface.
 *
 * Implements Single Responsibility Principle (SRP) by keeping state management pure,
 * deterministic, and decoupled from React hooks and DOM event handlers.
 */

import type { RepairReport } from "./core/model";

/** The current high-level state of the repair tool UI. */
export type RepairState =
  | { kind: "idle" }
  | { kind: "ready"; file: File }
  | {
      kind: "repairing";
      file: File;
      progress: number;
      stage?: string;
    }
  | {
      kind: "repaired";
      file: File;
      pdf: Blob;
      pageCount: number;
      report: RepairReport;
      warnings?: string;
    }
  | {
      kind: "password-required";
      file: File;
      error?: string;
    }
  | {
      kind: "unrecoverable";
      file: File;
      reason: string;
    }
  | {
      kind: "error";
      file: File;
      message: string;
    };

/** State transition actions dispatched by UI interactions and worker callbacks. */
export type RepairAction =
  | { type: "select-file"; file: File }
  | { type: "clear-file" }
  | { type: "start-repair" }
  | { type: "progress"; progress: number; stage?: string }
  | {
      type: "repair-success";
      pdf: Blob;
      pageCount: number;
      report: RepairReport;
      warnings?: string;
    }
  | { type: "repair-password-required"; error?: string }
  | { type: "repair-unrecoverable"; reason: string }
  | { type: "repair-error"; message: string }
  | { type: "cancel" };

/** Default initial state when the page is loaded. */
export const INITIAL_REPAIR_STATE: RepairState = { kind: "idle" };

/**
 * Pure state reducer determining next UI state from current state and incoming action.
 *
 * Rules:
 * - Selecting a new file always resets repair results to "ready".
 * - "start-repair" transitions from "ready", "password-required", or "error" to "repairing".
 * - While "repairing", progress updates change progress fraction and stage description.
 * - Out-of-order success/failure actions are ignored if the user has cancelled or changed file.
 * - "cancel" returns from "repairing" back to "ready".
 * - "clear-file" transitions unconditionally back to "idle".
 *
 * @param state Current state.
 * @param action Dispatched action.
 * @returns Next state.
 */
export function repairReducer(
  state: RepairState,
  action: RepairAction,
): RepairState {
  switch (action.type) {
    case "select-file":
      return { kind: "ready", file: action.file };

    case "clear-file":
      return { kind: "idle" };

    case "start-repair":
      if (
        state.kind === "ready" ||
        state.kind === "password-required" ||
        state.kind === "unrecoverable" ||
        state.kind === "error"
      ) {
        return {
          kind: "repairing",
          file: state.file,
          progress: 0,
          stage: "Starting repair...",
        };
      }
      return state;

    case "progress":
      if (state.kind === "repairing") {
        return {
          ...state,
          progress: action.progress,
          stage: action.stage ?? state.stage,
        };
      }
      return state;

    case "repair-success":
      if (state.kind === "repairing") {
        return {
          kind: "repaired",
          file: state.file,
          pdf: action.pdf,
          pageCount: action.pageCount,
          report: action.report,
          warnings: action.warnings,
        };
      }
      return state;

    case "repair-password-required":
      if (state.kind === "repairing") {
        return {
          kind: "password-required",
          file: state.file,
          error: action.error,
        };
      }
      return state;

    case "repair-unrecoverable":
      if (state.kind === "repairing") {
        return {
          kind: "unrecoverable",
          file: state.file,
          reason: action.reason,
        };
      }
      return state;

    case "repair-error":
      if (state.kind === "repairing") {
        return {
          kind: "error",
          file: state.file,
          message: action.message,
        };
      }
      return state;

    case "cancel":
      if (state.kind === "repairing") {
        return {
          kind: "ready",
          file: state.file,
        };
      }
      return state;

    default:
      return state;
  }
}
