"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applyToPoint } from "@/lib/affine";
import { Button } from "@/components/ui/button";
import { drawPixels } from "@/lib/draw-pixels";
import {
  userToView,
  viewSize,
  viewToUser,
  type PageBox,
} from "@/lib/pdfium/page-box";
import type { PageInfo } from "@/lib/pdfium/pdfium-document";
import { renderWidthFor } from "@/lib/render-width";
import { useElementWidth } from "@/lib/use-element-observers";
import type { RedactionMark, RedactionMarkStyle } from "./core/model";
import type { RenderResult } from "./messages";

/** Maximum preview height as a fraction of viewport height. */
export const MAX_PREVIEW_HEIGHT_VH = 70;
/** Minimum user-space side length (points) required to accept a dragged box. */
const MIN_BOX_PT = 4;

export interface PagePreviewProps {
  pageIndex: number;
  pageCount: number;
  info: PageInfo;
  marks: readonly RedactionMark[];
  selectedMarkId: string | null;
  style: RedactionMarkStyle;
  disabled?: boolean;
  renderPage(
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult>;
  onPageChange(pageIndex: number): void;
  onAddBox(box: PageBox): void;
  onSelectMark(id: string): void;
}

interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Project a user-space `PageBox` into SVG view-space coordinates (`y` down). */
function userBoxToViewRect(box: PageBox, info: PageInfo): ViewRect {
  const toView = userToView(info.box, info.rotation);
  const corners = [
    applyToPoint(toView, { x: box.left, y: box.bottom }),
    applyToPoint(toView, { x: box.right, y: box.bottom }),
    applyToPoint(toView, { x: box.left, y: box.top }),
    applyToPoint(toView, { x: box.right, y: box.top }),
  ];
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(0.5, maxX - minX),
    height: Math.max(0.5, maxY - minY),
  };
}

/**
 * Interactive PDF page preview with click-and-drag redaction box drawing and
 * live visual overlays for enabled vs unticked candidate marks.
 *
 * @param props Page geometry, marks on this page, render function, and callbacks.
 * @returns Preview section with page navigation and interactive SVG overlay.
 */
export function PagePreview({
  pageIndex,
  pageCount,
  info,
  marks,
  selectedMarkId,
  style,
  disabled,
  renderPage,
  onPageChange,
  onAddBox,
  onSelectMark,
}: PagePreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cssWidth = useElementWidth(boxRef);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const view = viewSize(info.box, info.rotation);
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const width = renderWidthFor(cssWidth, ratio);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssWidth === 0) return;
    const controller = new AbortController();
    renderPage(pageIndex, width, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status === "rendered") {
        drawPixels(canvas, result.width, result.height, result.pixels);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => controller.abort();
  }, [renderPage, pageIndex, width, cssWidth]);

  const clientToViewPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width > 0 ? view.width / rect.width : 1;
    const scaleY = rect.height > 0 ? view.height / rect.height : 1;
    return {
      x: Math.max(0, Math.min(view.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(view.height, (clientY - rect.top) * scaleY)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return;
    const pt = clientToViewPoint(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y });
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const pt = clientToViewPoint(e.clientX, e.clientY);
    setDrag((prev) => (prev ? { ...prev, curX: pt.x, curY: pt.y } : null));
  };

  const finishDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const minX = Math.min(drag.startX, drag.curX);
    const maxX = Math.max(drag.startX, drag.curX);
    const minY = Math.min(drag.startY, drag.curY);
    const maxY = Math.max(drag.startY, drag.curY);
    setDrag(null);

    if (maxX - minX < MIN_BOX_PT || maxY - minY < MIN_BOX_PT) return;

    const toUser = viewToUser(info.box, info.rotation);
    const p1 = applyToPoint(toUser, { x: minX, y: minY });
    const p2 = applyToPoint(toUser, { x: maxX, y: maxY });
    onAddBox({
      left: Math.min(p1.x, p2.x),
      bottom: Math.min(p1.y, p2.y),
      right: Math.max(p1.x, p2.x),
      top: Math.max(p1.y, p2.y),
    });
  };

  const pageMarks = marks.filter((m) => m.pageIndex === pageIndex);
  const labelText = style.label.trim();
  const isWhiteFill = style.fill === "white";
  const pageNumber = pageIndex + 1;

  return (
    <section aria-label="Page preview" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-muted-foreground text-sm font-medium">
            Page {pageNumber} of {pageCount}
          </h2>
          <p className="text-muted-foreground text-xs">
            Drag across any text or image area to draw a redaction box.
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Previous page"
            disabled={disabled || pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Next page"
            disabled={disabled || pageNumber === pageCount}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        ref={boxRef}
        className="relative mx-auto w-full overflow-hidden rounded-md border bg-white shadow-sm"
        style={{
          aspectRatio: `${view.width} / ${view.height}`,
          maxWidth: `calc(${MAX_PREVIEW_HEIGHT_VH}vh * ${view.width / view.height})`,
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="absolute inset-0 size-full"
        />
        <svg
          ref={svgRef}
          role="img"
          aria-label={`Redaction canvas for page ${pageNumber}`}
          viewBox={`0 0 ${view.width} ${view.height}`}
          className={`absolute inset-0 size-full touch-none ${
            disabled ? "cursor-default" : "cursor-crosshair"
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={() => setDrag(null)}
        >
          {pageMarks.map((mark) => {
            const vr = userBoxToViewRect(mark.box, info);
            const selected = mark.id === selectedMarkId;
            return (
              <g
                key={mark.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectMark(mark.id);
                }}
                className="cursor-pointer"
              >
                <rect
                  x={vr.x}
                  y={vr.y}
                  width={vr.width}
                  height={vr.height}
                  fill={
                    mark.enabled
                      ? isWhiteFill
                        ? "rgba(255,255,255,0.92)"
                        : "rgba(0,0,0,0.85)"
                      : "rgba(239,68,68,0.12)"
                  }
                  stroke={
                    selected
                      ? "#ef4444"
                      : mark.enabled
                        ? isWhiteFill
                          ? "#111827"
                          : "#ef4444"
                        : "#9ca3af"
                  }
                  strokeWidth={selected ? 2 : 1}
                  strokeDasharray={mark.enabled ? undefined : "4 3"}
                />
                {mark.enabled &&
                  labelText.length > 0 &&
                  vr.height >= 7 &&
                  vr.width >= 20 && (
                    <text
                      x={vr.x + vr.width / 2}
                      y={vr.y + vr.height / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={isWhiteFill ? "#111827" : "#ffffff"}
                      fontSize={Math.max(4, Math.min(11, vr.height * 0.58))}
                      fontWeight="bold"
                      style={{ pointerEvents: "none" }}
                    >
                      {labelText}
                    </text>
                  )}
              </g>
            );
          })}

          {drag && (
            <rect
              x={Math.min(drag.startX, drag.curX)}
              y={Math.min(drag.startY, drag.curY)}
              width={Math.abs(drag.curX - drag.startX)}
              height={Math.abs(drag.curY - drag.startY)}
              fill="rgba(239, 68, 68, 0.2)"
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="4 2"
            />
          )}
        </svg>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Could not show this page: {error}
        </p>
      )}
    </section>
  );
}
