import { describe, expect, it } from "vitest";
import {
  NUDGE_LARGE,
  commandForKey,
  isEditableTarget,
  type KeyInput,
} from "./keyboard";

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  inField: false,
  ...extra,
});

describe("isEditableTarget", () => {
  it("recognises text entry elements", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
    const div = document.createElement("div");
    expect(isEditableTarget(div)).toBe(false);
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isEditableTarget(div)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

describe("commandForKey", () => {
  it("maps undo and redo with Ctrl or Cmd", () => {
    expect(commandForKey(key("z", { ctrlKey: true }))).toEqual({
      type: "undo",
    });
    expect(commandForKey(key("Z", { metaKey: true, shiftKey: true }))).toEqual({
      type: "redo",
    });
    expect(commandForKey(key("y", { ctrlKey: true }))).toEqual({
      type: "redo",
    });
    expect(commandForKey(key("s", { ctrlKey: true }))).toBeNull();
  });

  it("maps Delete and Backspace to delete", () => {
    expect(commandForKey(key("Delete"))).toEqual({ type: "delete" });
    expect(commandForKey(key("Backspace"))).toEqual({ type: "delete" });
  });

  it("nudges with the arrow keys, further with Shift", () => {
    expect(commandForKey(key("ArrowLeft"))).toEqual({
      type: "nudge",
      delta: { x: -1, y: 0 },
    });
    expect(commandForKey(key("ArrowDown", { shiftKey: true }))).toEqual({
      type: "nudge",
      delta: { x: 0, y: NUDGE_LARGE },
    });
  });

  it("leaves keys alone inside fields, except Escape", () => {
    expect(commandForKey(key("Backspace", { inField: true }))).toBeNull();
    expect(
      commandForKey(key("z", { ctrlKey: true, inField: true })),
    ).toBeNull();
    expect(commandForKey(key("Escape", { inField: true }))).toEqual({
      type: "escape",
    });
  });

  it("ignores other keys", () => {
    expect(commandForKey(key("a"))).toBeNull();
  });
});
