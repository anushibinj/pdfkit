"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ObjectPatch } from "./core/editor-state";
import {
  clientToViewPoint,
  createImageObject,
  createTextObject,
  finishGesture,
  previewObject,
  startInk,
  updateGesture,
  type DrawingTool,
  type Gesture,
  type GesturePage,
  type ToolStyle,
} from "./core/gestures";
import type {
  BoxObject,
  EditObject,
  EditorPage,
  ImageAsset,
  PageInfo,
  Point,
} from "./core/model";
import { objectToView } from "./core/object-frame";
import { addTurns, viewSize } from "./core/page-geometry";
import type { FontMetricsSource } from "./core/text-layout";
import { ObjectShape } from "./object-shape";
import { cn } from "@/lib/utils";

/** Resize handles are drawn this many CSS pixels wide, at any zoom. */
const HANDLE_CSS_PX = 16;

export interface PageOverlayProps {
  page: EditorPage;
  info: PageInfo;
  /** Number of the page as shown (1-based), for its accessible name. */
  pageNumber: number;
  /** The overlay's current width in CSS pixels (0 if not measured yet). */
  cssWidth: number;
  tool: DrawingTool;
  style: ToolStyle;
  /** Id of the selected object if it is on this page. */
  selectedId: string | null;
  imageUrls: ReadonlyMap<string, string>;
  metrics: FontMetricsSource;
  /** An image waiting to be placed by the next click, if any. */
  pendingImage: Pick<ImageAsset, "id" | "pixelWidth" | "pixelHeight"> | null;
  /** Returns a fresh object id. */
  newId(): string;
  onAdd(object: EditObject): void;
  onUpdate(objectId: string, patch: ObjectPatch): void;
  onSelect(objectId: string | null): void;
}

/**
 * The interactive layer over one rendered page.
 *
 * The SVG's `viewBox` is the displayed page in points, so SVG coordinates
 * are view-space coordinates and the browser scales them to the element's
 * size. Each object is drawn through its own local-to-view transform.
 *
 * Pointer handling, by tool:
 * - select: pressing an object selects it and starts a move; its handle
 *   starts a resize; pressing empty paper clears the selection;
 * - text: a click places a text object;
 * - pen: press, drag and release draws a stroke;
 * - box, highlight, white-out: drag a rectangle (or click for a default);
 * - with an image waiting to be placed, a click places it (any tool).
 * The gesture in progress lives in local state and is previewed live; only
 * the finished result is sent up, so a whole drag is one undo step.
 * Pointer capture keeps the gesture alive when the pointer leaves the page.
 *
 * @param props See {@link PageOverlayProps}.
 * @returns The overlay SVG.
 */
export function PageOverlay(props: PageOverlayProps) {
  const { page, info, tool, style, selectedId, metrics, pendingImage } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const geom: GesturePage = {
    box: info.box,
    turns: addTurns(info.rotation, page.rotation),
  };
  const view = viewSize(geom.box, geom.turns);
  const handleSize =
    props.cssWidth > 0 ? (HANDLE_CSS_PX * view.width) / props.cssWidth : 10;
  const placing = pendingImage !== null;
  const selecting = tool === "select" && !placing;

  /** Pointer position in view space. */
  const toView = (e: ReactPointerEvent): Point => {
    const rect = svgRef.current?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
    return clientToViewPoint({ x: e.clientX, y: e.clientY }, rect, view);
  };

  /** Start tracking a gesture and capture the pointer for its duration. */
  const begin = (e: ReactPointerEvent, next: Gesture) => {
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setGesture(next);
  };

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const at = toView(e);
    if (pendingImage) {
      props.onAdd(createImageObject(props.newId(), at, geom, pendingImage));
      return;
    }
    switch (tool) {
      case "select":
        props.onSelect(null);
        return;
      case "text":
        props.onAdd(createTextObject(props.newId(), at, geom, style));
        return;
      case "ink":
        begin(e, startInk(at, geom));
        return;
      default:
        begin(e, { kind: "draw-box", tool, start: at, current: at });
    }
  };

  const onObjectDown = (e: ReactPointerEvent, object: EditObject) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onSelect(object.id);
    const at = toView(e);
    begin(e, { kind: "move", object, start: at, current: at });
  };

  const onHandleDown = (e: ReactPointerEvent, object: BoxObject) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const at = toView(e);
    begin(e, { kind: "resize", object, start: at, current: at });
  };

  const onMove = (e: ReactPointerEvent) => {
    if (gesture) setGesture(updateGesture(gesture, toView(e), geom));
  };

  const onUp = (e: ReactPointerEvent) => {
    if (!gesture) return;
    const drawing = gesture.kind === "draw-ink" || gesture.kind === "draw-box";
    const outcome = finishGesture(
      updateGesture(gesture, toView(e), geom),
      geom,
      style,
      drawing ? props.newId() : "",
    );
    setGesture(null);
    if (outcome?.type === "add") props.onAdd(outcome.object);
    else if (outcome?.type === "update")
      props.onUpdate(outcome.objectId, outcome.patch);
  };

  // While an object is moved or resized, its preview replaces it.
  const preview = gesture ? previewObject(gesture, geom, style, "draft") : null;
  const replacedId =
    gesture?.kind === "move" || gesture?.kind === "resize"
      ? gesture.object.id
      : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${view.width} ${view.height}`}
      aria-label={`Page ${props.pageNumber} editing area`}
      className={cn(
        "relative block h-auto w-full select-none",
        // Select mode: let the browser pan and pinch-zoom (the editor has no
        // zoom of its own). Drawing tools: the browser must not take the
        // gesture, or a stroke would scroll the page instead.
        selecting ? "touch-manipulation" : "touch-none",
        placing ||
          tool === "ink" ||
          tool === "rect" ||
          tool === "highlight" ||
          tool === "whiteout"
          ? "cursor-crosshair"
          : tool === "text"
            ? "cursor-text"
            : "cursor-default",
      )}
      onPointerDown={onBackgroundDown}
      // Clicking a non-focusable element makes the browser move focus to
      // the page body as the default action of "mousedown". That would steal
      // focus from the text field the editor focuses right after placing
      // text (the pointerdown handler runs first), so typing would go
      // nowhere. Cancelling mousedown keeps focus where it is; it does not
      // affect pointer events or clicks, and also stops the browser from
      // starting a text selection or a native drag of an <image>.
      onMouseDown={(e) => e.preventDefault()}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setGesture(null)}
    >
      {page.objects.map((object) =>
        object.id === replacedId ? null : (
          <ObjectShape
            key={object.id}
            object={object}
            transform={objectToView(object, geom.box, geom.turns)}
            metrics={metrics}
            imageUrl={
              object.kind === "image"
                ? props.imageUrls.get(object.imageId)
                : undefined
            }
            selected={object.id === selectedId}
            interactive={selecting}
            handleSize={handleSize}
            onPointerDown={(e) => onObjectDown(e, object)}
            onHandlePointerDown={
              object.kind === "text" || object.kind === "ink"
                ? undefined
                : (e) => onHandleDown(e, object)
            }
            onFocus={() => props.onSelect(object.id)}
          />
        ),
      )}
      {preview && (
        <ObjectShape
          object={preview}
          transform={objectToView(preview, geom.box, geom.turns)}
          metrics={metrics}
          imageUrl={
            preview.kind === "image"
              ? props.imageUrls.get(preview.imageId)
              : undefined
          }
          selected={replacedId !== null}
          handleSize={handleSize}
        />
      )}
    </svg>
  );
}
