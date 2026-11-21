"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { isEditableTarget } from "@/tools/edit/core/keyboard";
import { cn } from "@/lib/utils";
import { displayedSize, sourceMap } from "./core/board";
import {
  selectedKeys,
  type BoardAction,
  type BoardState,
} from "./core/board-state";
import { moveKeysBy, moveKeysTo } from "./core/arrange";
import { columnCount } from "./core/drag";
import {
  boardCommandForKey,
  isGlobalCommand,
  moveDelta,
  stepIndex,
} from "./core/keyboard";
import type { SelectMode } from "./core/selection";
import { ZOOM_LEVELS } from "./core/zoom";
import {
  PageThumbnail,
  shapeOf,
  type ThumbnailRenderer,
} from "./page-thumbnail";
import { useBoardDrag } from "./use-board-drag";

/**
 * How a click selects, from its modifier keys (file-manager conventions).
 *
 * @param event The click's modifiers.
 * @param onTick Whether the click hit the page's tick, which always toggles
 *   (it is how touch screens, without modifier keys, select several pages).
 * @returns The selection mode.
 */
export function selectModeFor(
  event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  onTick: boolean,
): SelectMode {
  const mod = event.ctrlKey || event.metaKey;
  if (event.shiftKey) return mod ? "add-range" : "range";
  return mod || onTick ? "toggle" : "only";
}

/**
 * Find a page's card inside the board.
 *
 * @param container The board element.
 * @param key The page key.
 * @returns The card element, or `null`.
 */
export function cardFor(
  container: HTMLElement | null,
  key: string,
): HTMLElement | null {
  if (!container) return null;
  for (const child of container.children) {
    if (child instanceof HTMLElement && child.dataset.key === key) return child;
  }
  return null;
}

/**
 * Columns in the board right now, measured from the first row of cards
 * (only the first row is read, so a 5000-page board costs a few reads).
 *
 * @param container The board element.
 * @returns Cards per row (at least 1).
 */
export function measureColumns(container: HTMLElement | null): number {
  if (!container) return 1;
  const tops: number[] = [];
  for (const child of container.children) {
    if (!(child instanceof HTMLElement) || !child.dataset.key) continue;
    tops.push(child.offsetTop);
    if (tops.length > 1 && tops[tops.length - 1] !== tops[0]) break;
  }
  return columnCount(tops);
}

interface PageBoardProps {
  state: BoardState;
  dispatch: Dispatch<BoardAction>;
  render: ThumbnailRenderer;
  /** Index into `ZOOM_LEVELS`. */
  zoom: number;
  /** Blocks every change (while saving). */
  disabled: boolean;
  /** Called after a keyboard or drag action, for the screen reader. */
  onAnnounce(message: string): void;
}

/**
 * The page board: every output page as a card in a wrapping grid.
 *
 * It is an ARIA multi-select listbox with a roving tab stop: Tab enters at
 * one card (the last focused, or the first), arrow keys move between cards
 * (see `boardCommandForKey` for every key). Clicks select with the usual
 * modifiers; dragging moves the selection (`useBoardDrag`).
 *
 * Keeping focus through a move: React moves the DOM node of a card whose
 * position changed, and a focused node that is moved loses focus. So a
 * keyboard move records the card that had focus (`refocus`), and a layout
 * effect focuses it again after the new order is in the DOM.
 *
 * @param props State, dispatch, renderer and view options.
 * @returns The board.
 */
export function PageBoard({
  state,
  dispatch,
  render,
  zoom,
  disabled,
  onAnnounce,
}: PageBoardProps) {
  const pages = state.history.present;
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const refocus = useRef<string | null>(null);
  const helpId = useId();
  const sources = useMemo(() => sourceMap(state.sources), [state.sources]);
  const fileNumbers = useMemo(
    () => new Map(state.sources.map((s, i) => [s.id, i + 1])),
    [state.sources],
  );
  const keys = useMemo(() => pages.map((p) => p.key), [pages]);
  // The tab stop: the focused card, or the first one when it is gone.
  const tabKey =
    focusKey !== null && keys.includes(focusKey) ? focusKey : keys[0];

  const drag = useBoardDrag({
    containerRef,
    disabled,
    keysFor: (key) => {
      if (state.selection.keys.has(key)) return selectedKeys(state);
      dispatch({ type: "select", key, mode: "only" });
      return [key];
    },
    onDrop: (dragged, gap) => {
      dispatch({ type: "move-to", keys: dragged, gap });
      // Dropped where they already were: selected, but nothing moved.
      if (moveKeysTo(pages, new Set(dragged), gap) === pages) return;
      onAnnounce(
        `Moved ${dragged.length === 1 ? "1 page" : `${dragged.length} pages`}.`,
      );
    },
  });
  const draggedKeys = useMemo(
    () => new Set(drag.drag?.keys ?? []),
    [drag.drag],
  );
  const dropGap = drag.drag?.gap ?? null;

  // Keys as of the last run of the effect below, to find where a removed
  // page used to be.
  const previousKeys = useRef<readonly string[]>(keys);

  /*
   * Keep keyboard focus on the board when the page order changes.
   *
   * Two cases lose focus: React moves a focused card's DOM node (a keyboard
   * move), or the focused card is removed (Delete, or an undo). Either way
   * the browser drops focus to <body>. Steps:
   * 1. If focus is somewhere else on the page (a toolbar button), leave it:
   *    the user is working there.
   * 2. After a keyboard move, focus the moved page again (`refocus`, set
   *    only for moves that really change the order).
   * 3. If the focused page is gone and focus fell to <body>, focus the
   *    page that now sits at its position (or the new last page), as a
   *    listbox does after deleting an item.
   */
  useLayoutEffect(() => {
    const before = previousKeys.current;
    previousKeys.current = keys;
    const wanted = refocus.current;
    refocus.current = null;
    const container = containerRef.current;
    if (!container) return;
    const active = document.activeElement;
    const focusLost = active === null || active === document.body;
    if (!focusLost && !container.contains(active)) return;
    if (wanted !== null && keys.includes(wanted)) {
      const card = cardFor(container, wanted);
      if (card && active !== card) card.focus();
      return;
    }
    if (!focusLost || focusKey === null || keys.includes(focusKey)) return;
    const oldIndex = before.indexOf(focusKey);
    if (oldIndex < 0 || keys.length === 0) return;
    const next = keys[Math.min(oldIndex, keys.length - 1)];
    setFocusKey(next);
    cardFor(container, next)?.focus();
  }, [keys, focusKey]);

  /** Move the focus to the card at `index` (and keep it as the tab stop). */
  const focusIndex = useCallback(
    (index: number) => {
      const key = keys[index];
      if (key === undefined) return;
      setFocusKey(key);
      cardFor(containerRef.current, key)?.focus();
    },
    [keys],
  );

  // Stable (as long as `disabled` does not change), so memoised thumbnails
  // are not re-rendered for a new callback on every board render.
  const { consumeClick } = drag;
  const onCardClick = useCallback(
    (event: MouseEvent<HTMLElement>, key: string) => {
      event.stopPropagation();
      if (consumeClick() || disabled) return;
      const onTick =
        event.target instanceof Element &&
        event.target.closest("[data-toggle]") !== null;
      dispatch({ type: "select", key, mode: selectModeFor(event, onTick) });
    },
    [consumeClick, disabled, dispatch],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const command = boardCommandForKey({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      inField: isEditableTarget(event.target),
    });
    // Undo, redo and delete are window-wide shortcuts (index.tsx).
    if (!command || isGlobalCommand(command) || disabled) return;
    // The key went to the focused card, so the event says which page is
    // current. The tab stop in state can be one render behind the DOM
    // focus, so it is only the fallback.
    const targetKey =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-key]")?.dataset.key
        : undefined;
    const current = Math.max(
      0,
      keys.indexOf(
        targetKey !== undefined && keys.includes(targetKey)
          ? targetKey
          : (tabKey ?? ""),
      ),
    );
    const currentKey = keys[current];
    if (currentKey === undefined) return;
    event.preventDefault();
    switch (command.type) {
      case "focus": {
        const target = stepIndex(
          current,
          keys.length,
          measureColumns(containerRef.current),
          command.step,
        );
        if (command.extend) {
          if (state.selection.anchor === null)
            dispatch({ type: "select", key: currentKey, mode: "only" });
          dispatch({ type: "select", key: keys[target], mode: "range" });
        }
        focusIndex(target);
        return;
      }
      case "move": {
        // Moving an unselected page moves just that page.
        const moving = state.selection.keys.has(currentKey)
          ? state.selection.keys
          : new Set([currentKey]);
        if (!state.selection.keys.has(currentKey))
          dispatch({ type: "select", key: currentKey, mode: "only" });
        const delta = moveDelta(
          command.step,
          measureColumns(containerRef.current),
          keys.length,
        );
        // Already at that end: nothing moves, so nothing is announced and
        // no refocus is left behind for a later, unrelated change.
        if (moveKeysBy(pages, moving, delta) === pages) return;
        refocus.current = currentKey;
        dispatch({ type: "move-by", delta });
        onAnnounce(
          `Moved ${moving.size === 1 ? "1 page" : `${moving.size} pages`}.`,
        );
        return;
      }
      case "toggle":
        dispatch({ type: "select", key: currentKey, mode: "toggle" });
        return;
      case "select-all":
        dispatch({ type: "select-all" });
        return;
      case "select-none":
        dispatch({ type: "select-none" });
        return;
    }
  };

  return (
    <>
      <p id={helpId} className="sr-only">
        Arrow keys move between pages. Space selects a page; Shift with arrow
        keys selects a range; Control or Command with A selects all. Control or
        Command with arrow keys moves the selected pages. Delete removes them.
      </p>
      <div
        ref={containerRef}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Pages"
        aria-describedby={helpId}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onClick={() => {
          // A click on the board between cards clears the selection.
          if (!drag.consumeClick() && !disabled)
            dispatch({ type: "select-none" });
        }}
        className={cn(
          "grid gap-x-4 gap-y-3 pb-16",
          ZOOM_LEVELS[zoom]?.columns ?? ZOOM_LEVELS[0].columns,
        )}
      >
        {pages.map((page, index) => (
          <PageThumbnail
            key={page.key}
            page={page}
            index={index}
            source={
              page.kind === "source" ? sources.get(page.sourceId) : undefined
            }
            fileNumber={
              page.kind === "source" ? (fileNumbers.get(page.sourceId) ?? 0) : 0
            }
            {...shapeOf(displayedSize(page, sources))}
            selected={state.selection.keys.has(page.key)}
            tabbable={page.key === tabKey}
            dragging={draggedKeys.has(page.key)}
            dropMark={
              dropGap === index
                ? "before"
                : dropGap === index + 1 && index === pages.length - 1
                  ? "after"
                  : null
            }
            render={render}
            onPointerDown={drag.onPointerDown}
            onClick={onCardClick}
            onFocus={setFocusKey}
          />
        ))}
      </div>
      {drag.drag && (
        <div
          aria-hidden="true"
          className="bg-primary text-primary-foreground pointer-events-none fixed top-0 left-0 z-50 rounded-md px-2 py-1 text-sm font-medium shadow-lg"
          style={{
            transform: `translate(${drag.drag.x + 12}px, ${drag.drag.y + 12}px)`,
          }}
        >
          {drag.drag.keys.length === 1
            ? "1 page"
            : `${drag.drag.keys.length} pages`}
        </div>
      )}
    </>
  );
}
