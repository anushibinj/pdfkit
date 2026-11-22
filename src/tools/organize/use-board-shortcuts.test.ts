import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBoardShortcuts } from "./use-board-shortcuts";

/** Press a key on the window (or on `target`); returns the event. */
function press(
  key: string,
  mods: Partial<KeyboardEventInit> = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  target.dispatchEvent(event);
  return event;
}

/** Handlers that report the given outcome. */
const handlers = (did = true) => ({
  undo: vi.fn(() => did),
  redo: vi.fn(() => did),
  remove: vi.fn(() => did),
});

describe("useBoardShortcuts", () => {
  it("runs undo, redo and delete, and stops the browser's default", () => {
    const h = handlers();
    renderHook(() => useBoardShortcuts(true, h));
    expect(press("z", { ctrlKey: true }).defaultPrevented).toBe(true);
    press("z", { metaKey: true, shiftKey: true });
    press("y", { ctrlKey: true });
    press("Delete");
    press("Backspace");
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).toHaveBeenCalledTimes(2);
    expect(h.remove).toHaveBeenCalledTimes(2);
  });

  it("leaves the default alone when a handler did nothing", () => {
    renderHook(() => useBoardShortcuts(true, handlers(false)));
    expect(press("Delete").defaultPrevented).toBe(false);
  });

  it("ignores keys meant for the board itself and keys in text fields", () => {
    const h = handlers();
    renderHook(() => useBoardShortcuts(true, h));
    const input = document.createElement("input");
    document.body.append(input);
    press("Delete", {}, input);
    expect(press("ArrowLeft").defaultPrevented).toBe(false);
    press("a", { ctrlKey: true });
    press("Escape");
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.undo).not.toHaveBeenCalled();
    input.remove();
  });

  it("does nothing while disabled, and calls the latest handlers", () => {
    const first = handlers();
    const second = handlers();
    const { rerender } = renderHook(
      ({ enabled, h }) => useBoardShortcuts(enabled, h),
      { initialProps: { enabled: false, h: first } },
    );
    press("z", { ctrlKey: true });
    expect(first.undo).not.toHaveBeenCalled();
    rerender({ enabled: true, h: second });
    press("z", { ctrlKey: true });
    expect(second.undo).toHaveBeenCalledTimes(1);
    expect(first.undo).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", () => {
    const h = handlers();
    const { unmount } = renderHook(() => useBoardShortcuts(true, h));
    unmount();
    press("Delete");
    expect(h.remove).not.toHaveBeenCalled();
  });
});
