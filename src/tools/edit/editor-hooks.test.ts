import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useEditorShortcuts,
  type ShortcutHandlers,
} from "./use-editor-shortcuts";
import { useUnsavedWarning } from "./use-unsaved-warning";

const handlers = (handled = true): ShortcutHandlers => ({
  undo: vi.fn(() => handled),
  redo: vi.fn(() => handled),
  remove: vi.fn(() => handled),
  escape: vi.fn(() => handled),
  nudge: vi.fn(() => handled),
});

const press = (init: KeyboardEventInit, target: EventTarget = window) => {
  const event = new KeyboardEvent("keydown", {
    ...init,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

describe("useEditorShortcuts", () => {
  it("routes each command to its handler and suppresses the default", () => {
    const h = handlers();
    renderHook(() => useEditorShortcuts(true, h));
    expect(press({ key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    press({ key: "z", metaKey: true, shiftKey: true });
    press({ key: "Delete" });
    press({ key: "Escape" });
    press({ key: "ArrowRight", shiftKey: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.escape).toHaveBeenCalledTimes(1);
    expect(h.nudge).toHaveBeenCalledWith({ x: 10, y: 0 });
  });

  it("keeps the default when the handler did nothing (e.g. arrows scroll)", () => {
    renderHook(() => useEditorShortcuts(true, handlers(false)));
    expect(press({ key: "ArrowDown" }).defaultPrevented).toBe(false);
  });

  it("leaves typing in fields alone", () => {
    const h = handlers();
    renderHook(() => useEditorShortcuts(true, h));
    const input = document.body.appendChild(document.createElement("textarea"));
    press({ key: "Backspace" }, input);
    expect(h.remove).not.toHaveBeenCalled();
    input.remove();
  });

  it("does nothing while disabled, and stops listening on unmount", () => {
    const h = handlers();
    const { rerender, unmount } = renderHook(
      ({ on }) => useEditorShortcuts(on, h),
      {
        initialProps: { on: false },
      },
    );
    press({ key: "Delete" });
    expect(h.remove).not.toHaveBeenCalled();
    rerender({ on: true });
    unmount();
    press({ key: "Delete" });
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("always calls the latest handlers", () => {
    const first = handlers();
    const second = handlers();
    const { rerender } = renderHook(({ h }) => useEditorShortcuts(true, h), {
      initialProps: { h: first },
    });
    rerender({ h: second });
    press({ key: "Delete" });
    expect(first.remove).not.toHaveBeenCalled();
    expect(second.remove).toHaveBeenCalled();
  });
});

describe("useUnsavedWarning", () => {
  const leave = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  it("asks before leaving only while active", () => {
    const { rerender, unmount } = renderHook(
      ({ on }) => useUnsavedWarning(on),
      { initialProps: { on: false } },
    );
    expect(leave().defaultPrevented).toBe(false);
    rerender({ on: true });
    expect(leave().defaultPrevented).toBe(true);
    unmount();
    expect(leave().defaultPrevented).toBe(false);
  });
});
