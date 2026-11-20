"use client";

import { useEffect, useState } from "react";
import type { TextRun } from "./core/text-runs";
import type { TextRunsResult } from "./messages";

/** Lines of one page, or why they could not be read. */
export interface TextRunsState {
  /** The lines, or `null` while not loaded (or not wanted). */
  runs: readonly TextRun[] | null;
  /** Why loading failed, if it did. */
  error: string | null;
}

/**
 * The editable lines of a page, loaded when first wanted.
 *
 * Loading starts when `enabled` turns true (the Edit text tool is chosen
 * and the page is near the screen). An answer for a page the slot no
 * longer shows (pages can be moved) is ignored, so lines from one page are
 * never laid over another.
 *
 * @param load Fetches a page's lines (memoised per page by the caller).
 * @param sourceIndex The page in the original file.
 * @param enabled Whether the lines are needed now.
 * @returns The lines or the error.
 */
export function useTextRuns(
  load: (pageIndex: number) => Promise<TextRunsResult>,
  sourceIndex: number,
  enabled: boolean,
): TextRunsState {
  const [state, setState] = useState<
    (TextRunsState & { index: number }) | null
  >(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void load(sourceIndex).then((result) => {
      if (!current) return;
      setState(
        result.status === "text-runs"
          ? { index: sourceIndex, runs: result.runs, error: null }
          : { index: sourceIndex, runs: null, error: result.message },
      );
    });
    return () => {
      current = false;
    };
  }, [load, sourceIndex, enabled]);

  return state?.index === sourceIndex
    ? { runs: state.runs, error: state.error }
    : { runs: null, error: null };
}
