import type { PlanSettings, SplitMethod, ToolMode } from "./output-plan";
import {
  EMPTY_SELECTION,
  selectionReducer,
  type PageSelection,
  type SelectionAction,
} from "./page-selection";

/** Everything the person has set, as entered. */
export interface SplitSettings {
  mode: ToolMode;
  splitMethod: SplitMethod;
  /** "Pages per file", as typed: kept as text so the field can be empty. */
  everyN: string;
  /** The typed ranges for "custom ranges". */
  rangesText: string;
  /** The pages picked for extracting or removing. */
  selection: PageSelection;
}

export type SettingsAction =
  | { type: "set-mode"; mode: ToolMode }
  | { type: "set-split-method"; method: SplitMethod }
  | { type: "set-every"; value: string }
  | { type: "set-ranges"; value: string }
  /** A click on a thumbnail, typing in the page field, or Clear. */
  | { type: "selection"; action: SelectionAction }
  /** Back to the defaults (a new file was opened, or the file was closed). */
  | { type: "reset" };

/** The settings a freshly opened file starts with: split into single pages. */
export const INITIAL_SETTINGS: SplitSettings = {
  mode: "split",
  splitMethod: "every",
  everyN: "1",
  rangesText: "",
  selection: EMPTY_SELECTION,
};

/**
 * Apply one change to the settings. Pure: returns a new state.
 *
 * All settings live in this one reducer so that resetting them is a single
 * action that cannot forget a field.
 *
 * @param state The current settings.
 * @param action What changed.
 * @returns The next settings.
 */
export function settingsReducer(
  state: SplitSettings,
  action: SettingsAction,
): SplitSettings {
  switch (action.type) {
    case "set-mode":
      return { ...state, mode: action.mode };
    case "set-split-method":
      return { ...state, splitMethod: action.method };
    case "set-every":
      return { ...state, everyN: action.value };
    case "set-ranges":
      return { ...state, rangesText: action.value };
    case "selection":
      return { ...state, selection: selectionReducer(state.selection, action.action) };
    case "reset":
      return INITIAL_SETTINGS;
  }
}

/**
 * Turn the settings, as entered, into the planner's input.
 *
 * "Pages per file" is typed text. An empty (or blank) field means "not
 * entered yet", which must not be read as 0 (`Number("")` is 0), so it
 * becomes NaN, and the planner then asks for a whole number. Anything else
 * goes through `Number`, so "1.5" or "abc" also reach the planner as
 * invalid numbers and get the same message.
 *
 * @param settings The settings.
 * @param pageCount Pages in the open document.
 * @returns The planner's input.
 */
export function toPlanSettings(settings: SplitSettings, pageCount: number): PlanSettings {
  const typed = settings.everyN.trim();
  return {
    mode: settings.mode,
    pageCount,
    splitMethod: settings.splitMethod,
    everyN: typed === "" ? Number.NaN : Number(typed),
    rangesText: settings.rangesText,
    selection: settings.selection,
  };
}
