import { describe, expect, it } from "vitest";
import {
  boardCommandForKey,
  isGlobalCommand,
  moveDelta,
  stepIndex,
  type BoardKeyCommand,
} from "./keyboard";

/** A key press with no modifiers unless given. */
const press = (
  key: string,
  mods: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    inField: boolean;
  }> = {},
) =>
  boardCommandForKey({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    inField: false,
    ...mods,
  });

describe("boardCommandForKey", () => {
  it("arrows, Home and End move the focus; Shift extends", () => {
    expect(press("ArrowRight")).toEqual({
      type: "focus",
      step: "next",
      extend: false,
    });
    expect(press("ArrowUp", { shiftKey: true })).toEqual({
      type: "focus",
      step: "up",
      extend: true,
    });
    expect(press("Home")).toMatchObject({ step: "first" });
    expect(press("End")).toMatchObject({ step: "last" });
  });

  it("Ctrl or Cmd with arrows moves the selected pages", () => {
    expect(press("ArrowLeft", { ctrlKey: true })).toEqual({
      type: "move",
      step: "previous",
    });
    expect(press("End", { metaKey: true })).toEqual({
      type: "move",
      step: "last",
    });
  });

  it("maps selection, delete and history keys", () => {
    expect(press(" ")).toEqual({ type: "toggle" });
    expect(press("a", { ctrlKey: true })).toEqual({ type: "select-all" });
    expect(press("A", { metaKey: true })).toEqual({ type: "select-all" });
    expect(press("Escape")).toEqual({ type: "select-none" });
    expect(press("Delete")).toEqual({ type: "delete" });
    expect(press("Backspace")).toEqual({ type: "delete" });
    expect(press("z", { ctrlKey: true })).toEqual({ type: "undo" });
    expect(press("Z", { metaKey: true, shiftKey: true })).toEqual({
      type: "redo",
    });
    expect(press("y", { ctrlKey: true })).toEqual({ type: "redo" });
  });

  it("ignores keys in fields, keys with Alt and unknown keys", () => {
    expect(press("Delete", { inField: true })).toBeNull();
    expect(press("ArrowLeft", { altKey: true })).toBeNull();
    expect(press("x")).toBeNull();
    expect(press(" ", { ctrlKey: true })).toBeNull();
    expect(press("Delete", { ctrlKey: true })).toBeNull();
  });
});

describe("isGlobalCommand", () => {
  it("is true for undo, redo and delete only", () => {
    const global: BoardKeyCommand[] = [
      { type: "undo" },
      { type: "redo" },
      { type: "delete" },
    ];
    const local: BoardKeyCommand[] = [
      { type: "toggle" },
      { type: "select-all" },
      { type: "select-none" },
      { type: "move", step: "next" },
      { type: "focus", step: "next", extend: false },
    ];
    for (const c of global) expect(isGlobalCommand(c)).toBe(true);
    for (const c of local) expect(isGlobalCommand(c)).toBe(false);
  });
});

describe("stepIndex", () => {
  // 10 items in rows of 4:  0 1 2 3 / 4 5 6 7 / 8 9
  it("walks reading order left and right, across rows", () => {
    expect(stepIndex(3, 10, 4, "next")).toBe(4);
    expect(stepIndex(4, 10, 4, "previous")).toBe(3);
  });

  it("jumps whole rows up and down, clamped to the grid", () => {
    expect(stepIndex(5, 10, 4, "up")).toBe(1);
    expect(stepIndex(5, 10, 4, "down")).toBe(9);
    expect(stepIndex(7, 10, 4, "down")).toBe(9);
    expect(stepIndex(1, 10, 4, "up")).toBe(0);
  });

  it("goes to either end", () => {
    expect(stepIndex(5, 10, 4, "first")).toBe(0);
    expect(stepIndex(5, 10, 4, "last")).toBe(9);
  });

  it("survives empty grids and junk column counts", () => {
    expect(stepIndex(0, 0, 4, "next")).toBe(0);
    expect(stepIndex(2, 5, 0, "down")).toBe(3);
    expect(stepIndex(2, 5, Number.NaN, "up")).toBe(1);
  });
});

describe("moveDelta", () => {
  it("is one place sideways, one row vertically, the whole board to the ends", () => {
    expect(moveDelta("previous", 4, 10)).toBe(-1);
    expect(moveDelta("next", 4, 10)).toBe(1);
    expect(moveDelta("up", 4, 10)).toBe(-4);
    expect(moveDelta("down", 4, 10)).toBe(4);
    expect(moveDelta("first", 4, 10)).toBe(-10);
    expect(moveDelta("last", 4, 10)).toBe(10);
    expect(moveDelta("down", 0, 10)).toBe(1);
  });
});
