"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { autoScrollSpeed, gapAtPointer, passedThreshold } from "./core/drag";

/** A drag in progress. */
export interface BoardDrag {
  /** The pages being dragged, in board order. */
  keys: string[];
  /** Pointer position in the viewport, for the floating label. */
  x: number;
  y: number;
  /** Where the pages would land (see `moveKeysTo`), or `null` if unknown yet. */
  gap: number | null;
}

/** Inputs for {@link useBoardDrag}. */
export interface BoardDragOptions {
  /** The board element; only cards inside it are drop targets. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * The pages a drag that starts on `key` moves: the selection if `key` is
   * selected, otherwise `key` alone.
   */
  keysFor(key: string): string[];
  /** The drag ended over the board: move `keys` to `gap`. */
  onDrop(keys: string[], gap: number): void;
  /** No drag starts while true (saving, a dialog is open). */
  disabled: boolean;
}

/** What the board needs from the hook. */
export interface BoardDragHandle {
  /** The drag in progress, or `null`. */
  drag: BoardDrag | null;
  /** Attach to each card's `onPointerDown`. */
  onPointerDown(event: ReactPointerEvent<HTMLElement>, key: string): void;
  /**
   * Call first in click handlers: returns `true` (and resets) when the
   * click is the tail of a drag and must be ignored.
   */
  consumeClick(): boolean;
}

/** Selector of the element a touch drag must start on. */
export const DRAG_HANDLE_SELECTOR = "[data-drag-handle]";

/**
 * Which gap of the board is under a viewport point.
 *
 * The card under the point is found by hit testing (`elementFromPoint`)
 * and read from its `data-board-index`; the floating label has
 * `pointer-events: none`, so it never hides the card. Over a gap between
 * cards there is no card, and the caller keeps the last known gap, which
 * stops the indicator flickering while the pointer crosses the gaps.
 *
 * @param container The board element.
 * @param x Viewport x.
 * @param y Viewport y.
 * @returns The gap, or `null` when the point is not over a card.
 */
export function gapAtPoint(
  container: HTMLElement,
  x: number,
  y: number,
): number | null {
  const hit =
    typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(x, y)
      : null;
  const card = hit?.closest<HTMLElement>("[data-board-index]");
  if (!card || !container.contains(card)) return null;
  const index = Number(card.dataset.boardIndex);
  if (!Number.isInteger(index)) return null;
  return gapAtPointer(index, card.getBoundingClientRect(), x);
}

/**
 * Drag pages around the board with a mouse, pen or finger.
 *
 * Pointer events are used instead of HTML drag and drop, which does not
 * work with touch screens in most browsers. The flow:
 * 1. `pointerdown` on a card remembers where the press started. A mouse
 *    or pen press anywhere on the card counts; a touch only counts on the
 *    card's grip (`data-drag-handle`, which has `touch-action: none`), so
 *    a finger swiping across the board still scrolls it.
 * 2. Moves are followed on `window`, so the drag continues when the
 *    pointer leaves the card. Until the pointer has travelled
 *    `DRAG_THRESHOLD` pixels the press is still a click; after that it is
 *    a drag, and the gap under the pointer is tracked.
 * 3. While dragging, an animation-frame loop scrolls the window when the
 *    pointer is near the top or bottom edge, and re-tracks the gap after
 *    each scroll (the cards moved under a still pointer).
 * 4. `pointerup` drops at the last known gap. `pointercancel` (the browser
 *    took over the gesture) or Escape abandons the drag.
 * 5. The click that follows a drag's `pointerup` is swallowed through
 *    `consumeClick`, so dropping never also changes the selection.
 *
 * @param options The board, the selection logic and the drop callback.
 * @returns The current drag and the handlers.
 */
export function useBoardDrag(options: BoardDragOptions): BoardDragHandle {
  const [drag, setDrag] = useState<BoardDrag | null>(null);
  const latest = useRef(options);
  const suppressClick = useRef(false);
  // Detaches the window listeners of the press in progress, if any.
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => () => stopRef.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, key: string) => {
      if (latest.current.disabled || event.button !== 0) return;
      const onHandle =
        event.target instanceof Element &&
        event.target.closest(DRAG_HANDLE_SELECTOR) !== null;
      if (event.pointerType === "touch" && !onHandle) return;
      stopRef.current?.();

      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let current: BoardDrag | null = null;
      let frame = 0;

      const update = (x: number, y: number) => {
        if (!current) return;
        const container = latest.current.containerRef.current;
        const gap = container ? gapAtPoint(container, x, y) : null;
        current = { ...current, x, y, gap: gap ?? current.gap };
        setDrag(current);
      };

      const scrollLoop = () => {
        if (!current) return;
        const speed = autoScrollSpeed(current.y, window.innerHeight);
        if (speed !== 0) {
          window.scrollBy(0, speed);
          update(current.x, current.y);
        }
        frame = requestAnimationFrame(scrollLoop);
      };

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (!current) {
          if (!passedThreshold(e.clientX - startX, e.clientY - startY)) return;
          current = {
            keys: latest.current.keysFor(key),
            x: e.clientX,
            y: e.clientY,
            gap: null,
          };
          frame = requestAnimationFrame(scrollLoop);
        }
        e.preventDefault();
        update(e.clientX, e.clientY);
      };

      const stop = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        // Registered in the capture phase: removal must say so too.
        window.removeEventListener("keydown", onKey, true);
        stopRef.current = null;
        current = null;
        setDrag(null);
      };

      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        const finished = current;
        stop();
        if (!finished) return;
        // The click event that follows this pointerup belongs to the drag.
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        if (finished.gap !== null)
          latest.current.onDrop(finished.keys, finished.gap);
      };

      const onCancel = (e: PointerEvent) => {
        if (e.pointerId === pointerId) stop();
      };

      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !current) return;
        e.preventDefault();
        e.stopPropagation();
        stop();
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      stopRef.current = stop;
    },
    [],
  );

  const consumeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { drag, onPointerDown, consumeClick };
}
