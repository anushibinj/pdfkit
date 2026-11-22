/**
 * State of one conversion run (pages to images, or image extraction), from
 * the UI's point of view. Pure.
 */
import type { ExtractionMethod } from "../engine/extraction-strategies";
import type { ImageMimeType } from "../engine/images-session";

/** What a run produces. */
export type ConversionMode = "pages" | "images";

/** One produced file. */
export interface OutputFile {
  /** Stable id: "page-<index>" for pages, the image key for images. */
  id: string;
  blob: Blob;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  /**
   * 1-based numbers of the pages the file comes from: one page for a
   * rendered page, every page an extracted image appears on.
   */
  pages: number[];
  /** Pages only: the resolution achieved. */
  dpi?: number;
  /** Pages only: the resolution was lowered to fit the browser's limits. */
  reduced?: boolean;
  /** Images only: how the image was extracted. */
  method?: ExtractionMethod;
}

/** An image that was found but could not be extracted. */
export interface SkippedImage {
  key: string;
  /** 1-based page number. */
  page: number;
  width: number;
  height: number;
  reason: string;
}

/** What one page contributed to an image extraction run. */
export interface PageImageFindings {
  /** 1-based page number. */
  page: number;
  /** New images. */
  files: OutputFile[];
  /** Keys of images seen before (on earlier pages or this one). */
  repeats: string[];
  skipped: SkippedImage[];
}

export type RunState =
  | { kind: "idle" }
  | {
      kind: "running";
      mode: ConversionMode;
      /** Pages processed so far. */
      done: number;
      /** Pages to process. */
      total: number;
      files: OutputFile[];
      skipped: SkippedImage[];
      /** The user asked to stop; the current page still finishes. */
      stopping: boolean;
    }
  | {
      kind: "finished";
      mode: ConversionMode;
      files: OutputFile[];
      skipped: SkippedImage[];
      /** The user stopped the run before every page was processed. */
      stopped: boolean;
    }
  | {
      kind: "failed";
      mode: ConversionMode;
      files: OutputFile[];
      skipped: SkippedImage[];
      message: string;
    };

export type RunAction =
  | { type: "start"; mode: ConversionMode; total: number }
  | { type: "page-rendered"; file: OutputFile }
  | { type: "images-found"; findings: PageImageFindings }
  | { type: "stop-requested" }
  | { type: "finish" }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const INITIAL_RUN_STATE: RunState = { kind: "idle" };

/**
 * Add the page numbers of repeated images to the files they repeat.
 *
 * An image drawn on pages 1, 4 and 9 is extracted once (on page 1); pages
 * 4 and 9 report it as a repeat by key. Each repeat adds its page to that
 * file's `pages`, once. A key without a file (an image that was skipped)
 * changes nothing. Files that do not change keep their identity.
 *
 * @param files The files so far.
 * @param keys Keys of the images repeated on `page`.
 * @param page 1-based page number.
 * @returns The files with the page recorded.
 */
export function recordRepeats(
  files: OutputFile[],
  keys: readonly string[],
  page: number,
): OutputFile[] {
  if (keys.length === 0) return files;
  const repeated = new Set(keys);
  return files.map((file) =>
    repeated.has(file.id) && !file.pages.includes(page)
      ? { ...file, pages: [...file.pages, page] }
      : file,
  );
}

/**
 * Pure transitions for a conversion run.
 *
 * Rules, and why:
 * - "start" is ignored while a run is going, so a double click cannot start
 *   a second run behind the first.
 * - Progress ("page-rendered", "images-found"), "stop-requested", "finish"
 *   and "fail" only apply while running. A late answer from a run that was
 *   reset must not change what the user sees now.
 * - "finish" records whether the user stopped the run early.
 * - "fail" keeps the files produced so far: they are still valid.
 * Unchanged state is returned as the same object, so React can skip a
 * render.
 *
 * @param state Current state.
 * @param action What happened.
 * @returns The next state.
 */
export function runReducer(state: RunState, action: RunAction): RunState {
  if (action.type === "reset") {
    return state.kind === "idle" ? state : INITIAL_RUN_STATE;
  }
  if (action.type === "start") {
    if (state.kind === "running") return state;
    return {
      kind: "running",
      mode: action.mode,
      done: 0,
      total: action.total,
      files: [],
      skipped: [],
      stopping: false,
    };
  }
  if (state.kind !== "running") return state;
  switch (action.type) {
    case "page-rendered":
      return {
        ...state,
        done: state.done + 1,
        files: [...state.files, action.file],
      };
    case "images-found": {
      const { page, files, repeats, skipped } = action.findings;
      return {
        ...state,
        done: state.done + 1,
        files: [...recordRepeats(state.files, repeats, page), ...files],
        skipped: [...state.skipped, ...skipped],
      };
    }
    case "stop-requested":
      return state.stopping ? state : { ...state, stopping: true };
    case "finish":
      return {
        kind: "finished",
        mode: state.mode,
        files: state.files,
        skipped: state.skipped,
        stopped: state.stopping,
      };
    case "fail":
      return {
        kind: "failed",
        mode: state.mode,
        files: state.files,
        skipped: state.skipped,
        message: action.message,
      };
  }
}
