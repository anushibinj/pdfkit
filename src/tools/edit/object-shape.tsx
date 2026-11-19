"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { toSvgTransform, type Matrix } from "./core/affine";
import { rgbToHex } from "./core/colors";
import {
  HIGHLIGHT_OPACITY,
  type EditObject,
  type FontFamily,
} from "./core/model";
import { localBounds } from "./core/object-bounds";
import { layoutText, type FontMetricsSource } from "./core/text-layout";
import { cn } from "@/lib/utils";

/**
 * Screen fonts for the preview. Each list starts with fonts whose letter
 * widths match the PDF standard font (Arial and Liberation Sans were
 * designed to match Helvetica, and so on), so preview lines are as long as
 * the saved ones.
 */
export const PREVIEW_FONT_FAMILY: Record<FontFamily, string> = {
  sans: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  mono: "'Courier New', Courier, 'Liberation Mono', monospace",
};

/**
 * Short, human description of an object for screen readers.
 *
 * @param object Any object.
 * @returns For example `Text: Hello` or `Highlight`.
 */
export function describeObject(object: EditObject): string {
  switch (object.kind) {
    case "text": {
      const firstLine = object.text.split("\n")[0];
      return `Text: ${firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine}`;
    }
    case "ink":
      return "Drawing";
    case "rect":
      return "Box";
    case "highlight":
      return "Highlight";
    case "whiteout":
      return "White-out";
    case "image":
      return "Image";
  }
}

interface ObjectShapeProps {
  object: EditObject;
  /** The object's local-to-view transform. */
  transform: Matrix;
  metrics: FontMetricsSource;
  /** Preview URL for image objects. */
  imageUrl?: string;
  selected?: boolean;
  /** Makes the object focusable and clickable (select tool only). */
  interactive?: boolean;
  /** Size of the resize handle in points (keeps it finger-sized on screen). */
  handleSize?: number;
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void;
  onHandlePointerDown?: (event: ReactPointerEvent<SVGRectElement>) => void;
  onFocus?: () => void;
}

/**
 * The visible part of an object, drawn in its local space (u right, v down).
 *
 * @param props The object, its metrics and its image URL.
 * @returns SVG elements.
 */
function ObjectBody({
  object,
  metrics,
  imageUrl,
}: Pick<ObjectShapeProps, "object" | "metrics" | "imageUrl">) {
  switch (object.kind) {
    case "text": {
      const layout = layoutText(
        object.text,
        object.font,
        object.fontSize,
        metrics,
      );
      return (
        <>
          {layout.lines.map((line, i) => (
            <text
              key={i}
              x={0}
              y={layout.baselines[i]}
              fontSize={object.fontSize}
              fontFamily={PREVIEW_FONT_FAMILY[object.font]}
              fill={rgbToHex(object.color)}
              xmlSpace="preserve"
            >
              {line}
            </text>
          ))}
        </>
      );
    }
    case "ink": {
      // One point on its own draws nothing; repeating it gives a dot with
      // round caps, like the saved file (see InkWriter).
      const points =
        object.points.length === 1
          ? [object.points[0], object.points[0]]
          : object.points;
      return (
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={rgbToHex(object.color)}
          strokeWidth={object.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    case "rect":
      return (
        <rect
          width={object.width}
          height={object.height}
          fill="none"
          stroke={rgbToHex(object.color)}
          strokeWidth={object.strokeWidth}
        />
      );
    case "highlight":
      return (
        <rect
          width={object.width}
          height={object.height}
          fill={rgbToHex(object.color)}
          fillOpacity={HIGHLIGHT_OPACITY}
          className="mix-blend-multiply"
        />
      );
    case "whiteout":
      return (
        <>
          <rect width={object.width} height={object.height} fill="#ffffff" />
          {/* Screen-only hint so a white box on white paper can be found. */}
          <rect
            width={object.width}
            height={object.height}
            fill="none"
            stroke="#94a3b8"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            data-preview-only=""
          />
        </>
      );
    case "image":
      return imageUrl ? (
        <image
          href={imageUrl}
          width={object.width}
          height={object.height}
          preserveAspectRatio="none"
        />
      ) : (
        <rect width={object.width} height={object.height} fill="#e2e8f0" />
      );
  }
}

/**
 * One edit object on the page overlay: its body, an invisible hit area over
 * its bounds (so thin strokes and text are easy to grab), and, when
 * selected, a dashed outline plus a resize handle for boxes and images.
 *
 * @param props See {@link ObjectShapeProps}.
 * @returns An SVG group.
 */
export function ObjectShape({
  object,
  transform,
  metrics,
  imageUrl,
  selected = false,
  interactive = false,
  handleSize = 10,
  onPointerDown,
  onHandlePointerDown,
  onFocus,
}: ObjectShapeProps) {
  const b = localBounds(object, metrics);
  const resizable = object.kind !== "text" && object.kind !== "ink";
  return (
    <g
      transform={toSvgTransform(transform)}
      data-object-id={object.id}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? describeObject(object) : undefined}
      aria-pressed={interactive ? selected : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onFocus={interactive ? onFocus : undefined}
      className={cn(
        interactive
          ? "cursor-move touch-none outline-none"
          : "pointer-events-none",
      )}
    >
      <ObjectBody object={object} metrics={metrics} imageUrl={imageUrl} />
      <rect
        x={b.x}
        y={b.y}
        width={b.width}
        height={b.height}
        fill="transparent"
      />
      {selected && (
        <>
          <rect
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            fill="none"
            stroke="#2563eb"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
            data-selection-outline=""
          />
          {resizable && interactive && (
            <rect
              x={b.x + b.width - handleSize / 2}
              y={b.y + b.height - handleSize / 2}
              width={handleSize}
              height={handleSize}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className="cursor-nwse-resize"
              aria-hidden="true"
              data-resize-handle=""
              onPointerDown={onHandlePointerDown}
            />
          )}
        </>
      )}
    </g>
  );
}
