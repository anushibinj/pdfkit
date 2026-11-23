/**
 * Pure deterministic state machine for the batch OCR PDF workflow.
 *
 * Follows Single Responsibility Principle (SRP) by keeping queue transitions,
 * option resets, password prompts, and active text-inspector selection separate
 * from React effects and JSX rendering.
 */

import type { OcrOptions, OcrReport } from "./core/model";
import { DEFAULT_OCR_OPTIONS } from "./core/options";

/** Per-file lifecycle state inside the OCR batch queue. */
export type OcrItemStatus =
  | { kind: "ready" }
  | { kind: "processing"; progress: number; stage?: string }
  | {
      kind: "completed";
      pdf: Blob;
      report: OcrReport;
      wasImageInput: boolean;
    }
  | { kind: "password-required"; wrongPassword?: boolean; dismissed?: boolean }
  | { kind: "error"; message: string };

/** One PDF or image entry in the OCR queue. */
export interface OcrFileItem {
  id: string;
  file: File;
  /** Remembered open password once the user unlocks an encrypted PDF. */
  password?: string;
  status: OcrItemStatus;
}

/** Root UI state for the OCR PDF tool. */
export interface OcrState {
  items: OcrFileItem[];
  options: OcrOptions;
  isProcessing: boolean;
  /** ID of the completed item whose extracted text panel is expanded, or `null`. */
  inspectedTextItemId: string | null;
}

/** Initial state when the OCR PDF tool loads. */
export const INITIAL_OCR_STATE: OcrState = {
  items: [],
  options: DEFAULT_OCR_OPTIONS,
  isProcessing: false,
  inspectedTextItemId: null,
};

/** Actions dispatched by user interactions and worker callbacks. */
export type OcrAction =
  | { type: "add-files"; entries: { id: string; file: File }[] }
  | { type: "remove-file"; id: string }
  | { type: "clear" }
  | { type: "set-options"; options: OcrOptions }
  | { type: "start-batch" }
  | { type: "start-item"; id: string }
  | { type: "item-progress"; id: string; progress: number; stage?: string }
  | {
      type: "item-completed";
      id: string;
      pdf: Blob;
      report: OcrReport;
      wasImageInput: boolean;
    }
  | { type: "item-password-required"; id: string; wrongPassword?: boolean }
  | { type: "submit-password"; id: string; password: string }
  | { type: "dismiss-password"; id: string }
  | { type: "reopen-password"; id: string }
  | { type: "item-error"; id: string; message: string }
  | { type: "finish-batch" }
  | { type: "cancel-batch" }
  | { type: "inspect-text"; itemId: string | null };

/**
 * Pure reducer governing batch OCR queueing, option updates, password prompts,
 * per-page progress updates, and text inspection panel selection.
 *
 * @param state Current {@link OcrState}.
 * @param action Dispatched {@link OcrAction}.
 * @returns Next {@link OcrState}.
 */
export function ocrReducer(state: OcrState, action: OcrAction): OcrState {
  switch (action.type) {
    case "add-files": {
      if (action.entries.length === 0) return state;
      const added: OcrFileItem[] = action.entries.map(({ id, file }) => ({
        id,
        file,
        status: { kind: "ready" },
      }));
      return {
        ...state,
        items: [...state.items, ...added],
      };
    }

    case "remove-file": {
      const nextItems = state.items.filter((i) => i.id !== action.id);
      return {
        ...state,
        items: nextItems,
        isProcessing: nextItems.length === 0 ? false : state.isProcessing,
        inspectedTextItemId:
          state.inspectedTextItemId === action.id
            ? null
            : state.inspectedTextItemId,
      };
    }

    case "clear":
      return {
        ...INITIAL_OCR_STATE,
        options: state.options,
      };

    case "set-options": {
      // Reset previously completed/failed items so downloads always match active languages & DPI.
      const items = state.items.map((item): OcrFileItem => {
        if (
          item.status.kind === "completed" ||
          item.status.kind === "error"
        ) {
          return { ...item, status: { kind: "ready" } };
        }
        return item;
      });
      return {
        ...state,
        options: action.options,
        items,
        inspectedTextItemId: null,
      };
    }

    case "start-batch":
      return {
        ...state,
        isProcessing: true,
        inspectedTextItemId: null,
      };

    case "start-item":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                status: {
                  kind: "processing",
                  progress: 0,
                  stage: "Starting…",
                },
              }
            : item,
        ),
      };

    case "item-progress":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id && item.status.kind === "processing"
            ? {
                ...item,
                status: {
                  kind: "processing",
                  progress: action.progress,
                  stage: action.stage ?? item.status.stage,
                },
              }
            : item,
        ),
      };

    case "item-completed":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                status: {
                  kind: "completed",
                  pdf: action.pdf,
                  report: action.report,
                  wasImageInput: action.wasImageInput,
                },
              }
            : item,
        ),
        // Automatically open the text result panel for single-file runs
        inspectedTextItemId:
          state.items.length === 1 ? action.id : state.inspectedTextItemId,
      };

    case "item-password-required":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                password: action.wrongPassword ? undefined : item.password,
                status: {
                  kind: "password-required",
                  wrongPassword: action.wrongPassword,
                  dismissed: false,
                },
              }
            : item,
        ),
      };

    case "submit-password":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                password: action.password,
                status: { kind: "ready" },
              }
            : item,
        ),
      };

    case "dismiss-password":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id && item.status.kind === "password-required"
            ? {
                ...item,
                status: { ...item.status, dismissed: true },
              }
            : item,
        ),
      };

    case "reopen-password":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id && item.status.kind === "password-required"
            ? {
                ...item,
                status: { ...item.status, dismissed: false },
              }
            : item,
        ),
      };

    case "item-error":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? { ...item, status: { kind: "error", message: action.message } }
            : item,
        ),
      };

    case "finish-batch":
      return {
        ...state,
        isProcessing: false,
      };

    case "cancel-batch":
      return {
        ...state,
        isProcessing: false,
        items: state.items.map((item) =>
          item.status.kind === "processing"
            ? { ...item, status: { kind: "ready" } }
            : item,
        ),
      };

    case "inspect-text":
      return {
        ...state,
        inspectedTextItemId: action.itemId,
      };
  }
}
