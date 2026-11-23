import { describe, expect, it } from "vitest";
import { planOutputs } from "./output-plan";
import {
  INITIAL_SETTINGS,
  settingsReducer,
  toPlanSettings,
  type SettingsAction,
  type SplitSettings,
} from "./split-settings";

const run = (...actions: SettingsAction[]): SplitSettings =>
  actions.reduce(settingsReducer, INITIAL_SETTINGS);

describe("settingsReducer", () => {
  it("starts as split into single pages", () => {
    expect(INITIAL_SETTINGS).toMatchObject({
      mode: "split",
      splitMethod: "every",
      everyN: "1",
      rangesText: "",
    });
  });

  it("changes one setting at a time", () => {
    const state = run(
      { type: "set-mode", mode: "remove" },
      { type: "set-split-method", method: "ranges" },
      { type: "set-every", value: "4" },
      { type: "set-ranges", value: "1-2" },
    );
    expect(state).toMatchObject({
      mode: "remove",
      splitMethod: "ranges",
      everyN: "4",
      rangesText: "1-2",
    });
  });

  it("passes selection actions to the selection reducer", () => {
    const state = run(
      { type: "selection", action: { type: "toggle", index: 2, extend: false } },
      { type: "selection", action: { type: "toggle", index: 0, extend: false } },
    );
    expect(state.selection.text).toBe("1, 3");
  });

  it("reset restores every default at once", () => {
    const state = run(
      { type: "set-mode", mode: "extract" },
      { type: "set-every", value: "9" },
      { type: "selection", action: { type: "toggle", index: 1, extend: false } },
      { type: "reset" },
    );
    expect(state).toBe(INITIAL_SETTINGS);
  });

  it("does not modify the previous state", () => {
    const before = run({ type: "set-every", value: "2" });
    settingsReducer(before, { type: "set-every", value: "3" });
    expect(before.everyN).toBe("2");
  });
});

describe("toPlanSettings", () => {
  it("copies the settings and adds the page count", () => {
    expect(toPlanSettings(run({ type: "set-every", value: " 3 " }), 10)).toEqual({
      mode: "split",
      pageCount: 10,
      splitMethod: "every",
      everyN: 3,
      rangesText: "",
      selection: INITIAL_SETTINGS.selection,
    });
  });

  it.each(["", "   "])("reads an empty field (%j) as not entered, not as 0", (value) => {
    const plan = planOutputs(toPlanSettings(run({ type: "set-every", value }), 10));
    expect(plan).toEqual({ ok: false, error: expect.stringMatching(/whole number/) });
  });

  it.each(["1.5", "abc"])("lets the planner reject %j", (value) => {
    expect(planOutputs(toPlanSettings(run({ type: "set-every", value }), 10)).ok).toBe(false);
  });
});
