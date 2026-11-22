"use client";

import { useEffect, useRef } from "react";
import { isEditableTarget } from "@/lib/keyboard";
import { boardCommandForKey, isGlobalCommand } from "./core/keyboard";

/**
 * What each window-wide shortcut does. Each returns whether it did
 * something; only then is the browser's default action suppressed.
 */
export interface BoardShortcutHandlers {
  undo(): boolean;
  redo(): boolean;
  remove(): boolean;
}

/**
 * Listen for the board's window-wide shortcuts: undo, redo and delete.
 *
 * They work wherever the focus is on the page (a toolbar button, a legend
 * entry), except in a text field. The keys that need a focused page
 * (arrows, Space, Ctrl/Cmd+A, Escape) are handled by the board itself, so
 * this listener ignores them (`isGlobalCommand`).
 *
 * The handlers are read through a ref refreshed after every render, so the
 * listener is attached once per `enabled` change yet always calls the
 * latest handlers with the latest state.
 *
 * @param enabled Listen only while the board is shown and no dialog is open.
 * @param handlers What to do for each command.
 */
export function useBoardShortcuts(
  enabled: boolean,
  handlers: BoardShortcutHandlers,
): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const command = boardCommandForKey({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        inField: isEditableTarget(e.target),
      });
      if (!command || !isGlobalCommand(command)) return;
      const h = ref.current;
      const handled =
        command.type === "undo"
          ? h.undo()
          : command.type === "redo"
            ? h.redo()
            : h.remove();
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
