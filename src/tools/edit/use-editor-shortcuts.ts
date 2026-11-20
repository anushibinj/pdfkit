"use client";

import { useEffect, useRef } from "react";
import { commandForKey, isEditableTarget } from "./core/keyboard";
import type { Point } from "./core/model";

/**
 * What each shortcut does. Each returns whether it did something; only then
 * is the browser's default action (scrolling for arrows, for example)
 * suppressed.
 */
export interface ShortcutHandlers {
  undo(): boolean;
  redo(): boolean;
  remove(): boolean;
  escape(): boolean;
  nudge(delta: Point): boolean;
}

/**
 * Listen for the editor's keyboard shortcuts on the whole window.
 *
 * The handlers are read through a ref that is refreshed after every render,
 * so the listener is attached once (per `enabled` change) yet always calls
 * the latest handlers with the latest state.
 *
 * @param enabled Listen only while a document is open.
 * @param handlers What to do for each command.
 */
export function useEditorShortcuts(
  enabled: boolean,
  handlers: ShortcutHandlers,
): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const command = commandForKey({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        inField: isEditableTarget(e.target),
      });
      if (!command) return;
      const h = ref.current;
      const handled =
        command.type === "undo"
          ? h.undo()
          : command.type === "redo"
            ? h.redo()
            : command.type === "delete"
              ? h.remove()
              : command.type === "escape"
                ? h.escape()
                : h.nudge(command.delta);
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
