import type { ImageInfo } from "@/lib/image-info";
import type { QuarterTurns } from "@/lib/pdfium/page-box";
import type { FailureReason } from "../messages";
import { DEFAULT_LAYOUT_OPTIONS, type PageLayoutOptions } from "./options";

/** Validation lifecycle of one added image in the UI. */
export type ImageItemStatus =
  | { kind: "queued" }
  | { kind: "validating" }
  | { kind: "ready"; info: ImageInfo }
  | { kind: "error"; message: string };

/** One image entry in the user's ordered list. */
export interface ImageListItem {
  /** Stable client-generated identifier for React keys and focus tracking. */
  id: string;
  /** Original picked or dropped browser `File`. */
  file: File;
  /** Object URL for rendering a lightweight thumbnail preview, if created. */
  previewUrl?: string;
  /** Clockwise quarter-turn rotation chosen by the user (`0 | 1 | 2 | 3`). */
  rotation: QuarterTurns;
  /** Header + decode validation status. */
  status: ImageItemStatus;
}

/** Conversion lifecycle of the overall PDF build. */
export type BuildOutcome =
  | { kind: "idle" }
  | {
      kind: "building";
      /** Progress in `[0, 1]`. */
      progress: number;
      /** Optional human-readable stage (e.g. `"Adding image 2 of 5…"`). */
      stage?: string;
    }
  | { kind: "done"; pdf: Blob; pageCount: number }
  | { kind: "error"; reason: FailureReason; message: string };

/** Full UI state managed by {@link imagesReducer}. */
export interface ImagesToPdfState {
  items: ImageListItem[];
  options: PageLayoutOptions;
  outcome: BuildOutcome;
}

/** Actions handled by {@link imagesReducer}. */
export type ImagesToPdfAction =
  | {
      type: "add";
      items: { id: string; file: File; previewUrl?: string }[];
    }
  | { type: "validate-started"; id: string }
  | { type: "validated"; id: string; info: ImageInfo }
  | { type: "validation-failed"; id: string; message: string }
  | { type: "move"; id: string; offset: -1 | 1 }
  | { type: "rotate"; id: string; delta: 1 | -1 }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "set-options"; options: PageLayoutOptions }
  | { type: "build-started" }
  | { type: "build-progress"; progress: number; stage?: string }
  | { type: "build-succeeded"; pdf: Blob; pageCount: number }
  | { type: "build-failed"; reason: FailureReason; message: string };

/** Initial empty state before any images are added. */
export const INITIAL_IMAGES_STATE: ImagesToPdfState = {
  items: [],
  options: DEFAULT_LAYOUT_OPTIONS,
  outcome: { kind: "idle" },
};

/** Why the "Create PDF" button is disabled, if it is. */
export type BuildBlocker = "empty" | "validating" | "invalid";

/** Aggregated counts and readiness status for the current image list. */
export interface ImagesSummary {
  imageCount: number;
  totalBytes: number;
  /** `undefined` when every image is valid and conversion can start. */
  blocker?: BuildBlocker;
}

/**
 * Advance a quarter-turn rotation clockwise (`+1`) or counter-clockwise (`-1`),
 * wrapping cleanly within `{0, 1, 2, 3}`.
 *
 * @param current Current clockwise quarter turns.
 * @param delta Direction (`1` = +90° CW, `-1` = -90° CCW).
 * @returns Normalized next quarter-turn value.
 */
export function rotateQuarterTurns(
  current: QuarterTurns,
  delta: 1 | -1,
): QuarterTurns {
  return (((current + delta) % 4) + 4) % 4 as QuarterTurns;
}

/**
 * Summarize the image list's size and determine whether conversion is blocked.
 *
 * Blockers are ordered by what the user needs to address first:
 * 1. `"empty"` — no images added yet.
 * 2. `"validating"` — at least one image is still being checked.
 * 3. `"invalid"` — at least one image failed validation and must be removed.
 *
 * @param items Current ordered image list.
 * @returns Aggregated counts and optional blocker.
 */
export function imagesSummary(items: readonly ImageListItem[]): ImagesSummary {
  let totalBytes = 0;
  for (const item of items) {
    totalBytes += item.file.size;
  }
  const has = (kind: ImageItemStatus["kind"]) =>
    items.some((i) => i.status.kind === kind);

  const blocker: BuildBlocker | undefined =
    items.length === 0
      ? "empty"
      : has("queued") || has("validating")
        ? "validating"
        : has("error")
          ? "invalid"
          : undefined;

  return { imageCount: items.length, totalBytes, blocker };
}

/**
 * Select the next image waiting to be validated.
 *
 * Validating images sequentially (one at a time) keeps peak memory bounded when
 * a user drops dozens of large photos at once.
 *
 * @param items Current ordered image list.
 * @returns The first queued item, or `undefined` if one is already validating
 *   or none are queued.
 */
export function nextToValidate(
  items: readonly ImageListItem[],
): (ImageListItem & { status: { kind: "queued" } }) | undefined {
  if (items.some((i) => i.status.kind === "validating")) return undefined;
  return items.find(
    (i): i is ImageListItem & { status: { kind: "queued" } } =>
      i.status.kind === "queued",
  );
}

/**
 * Reset a stale conversion outcome back to `"idle"` whenever inputs change.
 *
 * Any mutation to the image list, order, rotation, or layout options invalidates
 * a previously built PDF so the user never accidentally downloads outdated output.
 *
 * @param outcome Current build outcome.
 * @returns `"idle"` unless already `"idle"`.
 */
function clearStaleOutcome(outcome: BuildOutcome): BuildOutcome {
  return outcome.kind === "idle" ? outcome : { kind: "idle" };
}

/**
 * Replace the status of one item by `id`, returning the original array if the
 * item is no longer present (e.g. removed while validation was in flight).
 *
 * @param items Current list.
 * @param id Target item identifier.
 * @param status Next status.
 * @returns Updated list.
 */
function updateItemStatus(
  items: readonly ImageListItem[],
  id: string,
  status: ImageItemStatus,
): ImageListItem[] {
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return items as ImageListItem[];
  const next = items.slice();
  next[index] = { ...next[index], status };
  return next;
}

/**
 * Pure state reducer for the Images to PDF tool.
 *
 * Invariant: while `outcome.kind === "building"`, list-mutating and
 * option-mutating actions (`add`, `move`, `rotate`, `remove`, `clear`,
 * `set-options`) are ignored so the UI cannot diverge from the worker job
 * currently in flight.
 *
 * @param state Current state.
 * @param action State transition to apply.
 * @returns Next state.
 */
export function imagesReducer(
  state: ImagesToPdfState,
  action: ImagesToPdfAction,
): ImagesToPdfState {
  const locked = state.outcome.kind === "building";

  switch (action.type) {
    case "add": {
      if (locked || action.items.length === 0) return state;
      const added: ImageListItem[] = action.items.map(
        ({ id, file, previewUrl }) => ({
          id,
          file,
          previewUrl,
          rotation: 0,
          status: { kind: "queued" },
        }),
      );
      return {
        ...state,
        items: [...state.items, ...added],
        outcome: clearStaleOutcome(state.outcome),
      };
    }

    case "validate-started":
      return {
        ...state,
        items: updateItemStatus(state.items, action.id, { kind: "validating" }),
      };

    case "validated":
      return {
        ...state,
        items: updateItemStatus(state.items, action.id, {
          kind: "ready",
          info: action.info,
        }),
      };

    case "validation-failed":
      return {
        ...state,
        items: updateItemStatus(state.items, action.id, {
          kind: "error",
          message: action.message,
        }),
      };

    case "move": {
      if (locked) return state;
      const from = state.items.findIndex((i) => i.id === action.id);
      const to = from + action.offset;
      if (from === -1 || to < 0 || to >= state.items.length) return state;
      const next = state.items.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return {
        ...state,
        items: next,
        outcome: clearStaleOutcome(state.outcome),
      };
    }

    case "rotate": {
      if (locked) return state;
      const index = state.items.findIndex((i) => i.id === action.id);
      if (index === -1) return state;
      const next = state.items.slice();
      next[index] = {
        ...next[index],
        rotation: rotateQuarterTurns(next[index].rotation, action.delta),
      };
      return {
        ...state,
        items: next,
        outcome: clearStaleOutcome(state.outcome),
      };
    }

    case "remove": {
      if (locked) return state;
      const next = state.items.filter((i) => i.id !== action.id);
      if (next.length === state.items.length) return state;
      return {
        ...state,
        items: next,
        outcome: clearStaleOutcome(state.outcome),
      };
    }

    case "clear": {
      if (locked || state.items.length === 0) return state;
      return {
        ...state,
        items: [],
        outcome: { kind: "idle" },
      };
    }

    case "set-options": {
      if (locked) return state;
      return {
        ...state,
        options: action.options,
        outcome: clearStaleOutcome(state.outcome),
      };
    }

    case "build-started":
      return {
        ...state,
        outcome: { kind: "building", progress: 0 },
      };

    case "build-progress":
      if (state.outcome.kind !== "building") return state;
      return {
        ...state,
        outcome: {
          kind: "building",
          progress: Math.min(1, Math.max(0, action.progress)),
          stage: action.stage,
        },
      };

    case "build-succeeded":
      return {
        ...state,
        outcome: {
          kind: "done",
          pdf: action.pdf,
          pageCount: action.pageCount,
        },
      };

    case "build-failed":
      return {
        ...state,
        outcome: {
          kind: "error",
          reason: action.reason,
          message: action.message,
        },
      };
  }
}
