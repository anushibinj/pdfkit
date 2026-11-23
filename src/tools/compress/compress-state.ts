/**
 * Pure deterministic state machine for the batch Compress PDF workflow.
 *
 * Follows Single Responsibility Principle (SRP) by separating state transitions
 * and batch invariants from React hook effects and JSX rendering.
 */

import type {
  CompressOptions,
  CompressReport,
  ResolvedPassConfig,
  TargetSizeEvaluation,
} from "./core/model";
import { DEFAULT_COMPRESS_OPTIONS } from "./core/options";

/** Per-file lifecycle state inside the batch compression queue. */
export type CompressItemStatus =
  | { kind: "ready" }
  | { kind: "compressing"; progress: number; stage?: string }
  | {
      kind: "compressed";
      pdf: Blob;
      pageCount: number;
      originalBytes: number;
      compressedBytes: number;
      report: CompressReport;
      appliedConfig: ResolvedPassConfig;
      targetEvaluation?: TargetSizeEvaluation;
      warnings?: string;
    }
  | { kind: "password-required"; wrongPassword?: boolean; dismissed?: boolean }
  | { kind: "error"; message: string };

/** One PDF entry in the compression batch list. */
export interface CompressFileItem {
  id: string;
  file: File;
  /** Remembered open password once the user unlocks an encrypted file. */
  password?: string;
  status: CompressItemStatus;
}

/** Side-by-side preview modal/panel state. */
export interface PreviewState {
  itemId: string;
  pageIndex: number;
  pageCount: number;
  width: number;
  height: number;
  loading: boolean;
  originalPixels?: Uint8Array;
  compressedPixels?: Uint8Array;
  error?: string;
}

/** Root UI state for the Compress PDF tool. */
export interface CompressState {
  items: CompressFileItem[];
  options: CompressOptions;
  isCompressing: boolean;
  preview: PreviewState | null;
}

/** Initial state when the tool loads. */
export const INITIAL_COMPRESS_STATE: CompressState = {
  items: [],
  options: DEFAULT_COMPRESS_OPTIONS,
  isCompressing: false,
  preview: null,
};

/** Actions dispatched by user interactions and worker callbacks. */
export type CompressAction =
  | { type: "add-files"; entries: { id: string; file: File }[] }
  | { type: "remove-file"; id: string }
  | { type: "clear" }
  | { type: "set-options"; options: CompressOptions }
  | { type: "start-batch" }
  | { type: "start-item"; id: string }
  | { type: "item-progress"; id: string; progress: number; stage?: string }
  | {
      type: "item-compressed";
      id: string;
      pdf: Blob;
      pageCount: number;
      originalBytes: number;
      compressedBytes: number;
      report: CompressReport;
      appliedConfig: ResolvedPassConfig;
      targetEvaluation?: TargetSizeEvaluation;
      warnings?: string;
    }
  | { type: "item-password-required"; id: string; wrongPassword?: boolean }
  | { type: "submit-password"; id: string; password: string }
  | { type: "dismiss-password"; id: string }
  | { type: "reopen-password"; id: string }
  | { type: "item-error"; id: string; message: string }
  | { type: "finish-batch" }
  | { type: "cancel-batch" }
  | { type: "open-preview"; itemId: string; pageIndex: number; pageCount: number }
  | {
      type: "preview-loaded";
      itemId: string;
      pageIndex: number;
      pageCount: number;
      width: number;
      height: number;
      originalPixels: Uint8Array;
      compressedPixels: Uint8Array;
    }
  | { type: "preview-error"; itemId: string; message: string }
  | { type: "close-preview" };

/**
 * Pure reducer governing batch file queueing, option updates, password prompts,
 * compression results, and side-by-side preview rendering.
 *
 * Rule: changing compression options resets already-compressed items back to `"ready"`
 * and clears stale previews so users never download results from outdated settings.
 *
 * @param state Current {@link CompressState}.
 * @param action Dispatched {@link CompressAction}.
 * @returns Next {@link CompressState}.
 */
export function compressReducer(
  state: CompressState,
  action: CompressAction,
): CompressState {
  switch (action.type) {
    case "add-files": {
      if (action.entries.length === 0) return state;
      const added: CompressFileItem[] = action.entries.map(({ id, file }) => ({
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
      const nextPreview =
        state.preview?.itemId === action.id ? null : state.preview;
      return {
        ...state,
        items: nextItems,
        preview: nextPreview,
        isCompressing: nextItems.length === 0 ? false : state.isCompressing,
      };
    }

    case "clear":
      return {
        ...INITIAL_COMPRESS_STATE,
        options: state.options,
      };

    case "set-options": {
      // Reset previously compressed/error results when settings change so output always matches UI
      const items = state.items.map((item): CompressFileItem => {
        if (
          item.status.kind === "compressed" ||
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
        preview: null,
      };
    }

    case "start-batch":
      return {
        ...state,
        isCompressing: true,
        preview: null,
      };

    case "start-item":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                status: {
                  kind: "compressing",
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
          item.id === action.id && item.status.kind === "compressing"
            ? {
                ...item,
                status: {
                  kind: "compressing",
                  progress: action.progress,
                  stage: action.stage ?? item.status.stage,
                },
              }
            : item,
        ),
      };

    case "item-compressed":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                status: {
                  kind: "compressed",
                  pdf: action.pdf,
                  pageCount: action.pageCount,
                  originalBytes: action.originalBytes,
                  compressedBytes: action.compressedBytes,
                  report: action.report,
                  appliedConfig: action.appliedConfig,
                  targetEvaluation: action.targetEvaluation,
                  warnings: action.warnings,
                },
              }
            : item,
        ),
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
        isCompressing: false,
      };

    case "cancel-batch":
      return {
        ...state,
        isCompressing: false,
        items: state.items.map((item) =>
          item.status.kind === "compressing"
            ? { ...item, status: { kind: "ready" } }
            : item,
        ),
      };

    case "open-preview":
      return {
        ...state,
        preview: {
          itemId: action.itemId,
          pageIndex: action.pageIndex,
          pageCount: action.pageCount,
          width: state.preview?.width ?? 0,
          height: state.preview?.height ?? 0,
          loading: true,
          originalPixels:
            state.preview?.itemId === action.itemId
              ? state.preview.originalPixels
              : undefined,
          compressedPixels:
            state.preview?.itemId === action.itemId
              ? state.preview.compressedPixels
              : undefined,
        },
      };

    case "preview-loaded":
      if (!state.preview || state.preview.itemId !== action.itemId) {
        return state;
      }
      return {
        ...state,
        preview: {
          itemId: action.itemId,
          pageIndex: action.pageIndex,
          pageCount: action.pageCount,
          width: action.width,
          height: action.height,
          loading: false,
          originalPixels: action.originalPixels,
          compressedPixels: action.compressedPixels,
        },
      };

    case "preview-error":
      if (!state.preview || state.preview.itemId !== action.itemId) {
        return state;
      }
      return {
        ...state,
        preview: {
          ...state.preview,
          loading: false,
          error: action.message,
        },
      };

    case "close-preview":
      return {
        ...state,
        preview: null,
      };
  }
}
