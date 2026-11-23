"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Point } from "@/lib/affine";
import type { Size } from "@/lib/pdfium/page-box";
import {
  RESIZE_HANDLES,
  cursorFor,
  dragRect,
  handlePosition,
  type DragHandle,
} from "./core/drag";
import type { ViewRect } from "./core/margins";

/** Every value of `data-handle` the overlay draws. */
const HANDLES: ReadonlySet<string> = new Set<DragHandle>([
  "move",
  ...RESIZE_HANDLES,
]);

/**
 * The handle an event happened on, from its `data-handle` attribute.
 *
 * @param target The event target.
 * @returns The handle, or `null` for anything else (the dimmed area).
 */
export function handleOf(target: EventTarget | null): DragHandle | null {
  const name =
    target instanceof Element ? target.getAttribute("data-handle") : null;
  return name !== null && HANDLES.has(name) ? (name as DragHandle) : null;
}

/** Side of a drag handle on screen, in CSS pixels. */
export const HANDLE_PX = 14;

interface CropOverlayProps {
  /** The displayed page size in points (the SVG's coordinate system). */
  view: Size;
  /** The crop area, or `null` when the margins leave nothing. */
  rect: ViewRect | null;
  /** The page's width on screen in CSS pixels (to size the handles). */
  cssWidth: number;
  onChange(rect: ViewRect): void;
  disabled?: boolean;
}

/** A drag in progress. */
interface Drag {
  handle: DragHandle;
  /** The rectangle when the drag began. */
  start: ViewRect;
  /** The pointer when the drag began, in view points. */
  origin: Point;
}

/**
 * The crop area drawn over the page: everything outside it dimmed, a frame
 * that moves when dragged, and eight handles that resize it. The handles
 * sit just inside the frame, so they stay visible at the page's edges.
 *
 * The SVG uses the page's own coordinates (points, as displayed), so the
 * rectangle maps to the page at any size. A pointer position is converted
 * by scaling its offset in the SVG's box to the page size. Dragging
 * captures the pointer, so the drag continues outside the page; touch
 * scrolling is disabled only on the frame and handles, so a finger can
 * still scroll the page elsewhere. Keyboard users set the same rectangle
 * through the margin fields next to the page.
 *
 * @param props The page size, crop area and change handler.
 * @returns The overlay (decorative for assistive technology).
 */
export function CropOverlay({
  view,
  rect,
  cssWidth,
  onChange,
  disabled,
}: CropOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const handleSize = HANDLE_PX * (cssWidth > 0 ? view.width / cssWidth : 1);

  /** A pointer event's position in view points. */
  const toView = (e: ReactPointerEvent): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - box.left) / box.width) * view.width,
      y: ((e.clientY - box.top) / box.height) * view.height,
    };
  };

  /** Start dragging the frame or handle under the pointer, if any. */
  const begin = (e: ReactPointerEvent<SVGSVGElement>) => {
    const handle = handleOf(e.target);
    if (!handle || disabled || !rect || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { handle, start: rect, origin: toView(e) };
  };

  const move = (e: ReactPointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const p = toView(e);
    onChange(
      dragRect(
        current.start,
        current.handle,
        { x: p.x - current.origin.x, y: p.y - current.origin.y },
        view,
      ),
    );
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${view.width} ${view.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="crop-overlay"
      className="absolute inset-0 size-full"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {rect && (
        <>
          <path
            d={`M0 0H${view.width}V${view.height}H0Z M${rect.x} ${rect.y}h${rect.width}v${rect.height}h${-rect.width}Z`}
            fillRule="evenodd"
            className="pointer-events-none fill-black/45"
          />
          <rect
            data-handle="move"
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            className="stroke-primary touch-none fill-transparent"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: disabled ? "default" : cursorFor("move") }}
          />
          {!disabled &&
            RESIZE_HANDLES.map((handle) => {
              const p = handlePosition(rect, handle, handleSize / 2);
              return (
                <rect
                  key={handle}
                  data-handle={handle}
                  x={p.x - handleSize / 2}
                  y={p.y - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  className="fill-background stroke-primary touch-none"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: cursorFor(handle) }}
                />
              );
            })}
        </>
      )}
    </svg>
  );
}
