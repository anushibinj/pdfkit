"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { drawPixels } from "@/lib/draw-pixels";
import { useElementWidth, useNearViewport } from "@/lib/use-element-observers";
import { cn } from "@/lib/utils";
import type { PageSize, RenderResult } from "./messages";

/** Rendered widths are rounded up to a multiple of this, in pixels. */
export const RENDER_STEP = 64;
/** How far outside the screen a thumbnail still counts as near. */
const NEAR = "800px 0px";

/**
 * The bitmap width for a thumbnail shown `cssWidth` CSS pixels wide.
 *
 * Multiplying by the device pixel ratio keeps thumbnails sharp on high
 * density screens. Rounding up to {@link RENDER_STEP} means small layout
 * changes (a scrollbar appearing, a window resized by a few pixels) reuse
 * the bitmap instead of drawing every page again.
 *
 * @param cssWidth The thumbnail's width in CSS pixels.
 * @param pixelRatio `window.devicePixelRatio` (1 when unknown).
 * @returns The width to request, at least {@link RENDER_STEP}; 0 for 0.
 */
export function renderWidthFor(cssWidth: number, pixelRatio: number): number {
  if (cssWidth <= 0) return 0;
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.max(RENDER_STEP, Math.ceil((cssWidth * ratio) / RENDER_STEP) * RENDER_STEP);
}

/** How a page is marked. */
export type ThumbnailMark = "none" | "picked" | "removed";

interface PageThumbnailProps {
  pageIndex: number;
  size: PageSize;
  renderPage(pageIndex: number, width: number, signal?: AbortSignal): Promise<RenderResult>;
  mark: ThumbnailMark;
  /** Makes the page a toggle button (extract and remove); omit to show only. */
  onToggle?(pageIndex: number, extend: boolean): void;
  /** A line under the page number, e.g. "File 2". */
  caption?: string;
  disabled?: boolean;
}

/**
 * One page of the grid: its thumbnail, number and an optional caption.
 *
 * Drawing: while the page is near the screen and its width is known, it
 * asks for a bitmap at {@link renderWidthFor} pixels. When the page scrolls
 * away or the width changes, the request is aborted (the engine skips it if
 * it has not started, and a late answer is ignored). A page that moves far
 * away also releases its bitmap: shrinking the canvas to 0 x 0 frees the
 * memory, so long files do not hold every page in memory.
 *
 * @param props The page, how to draw it and how it is marked.
 * @returns A list item.
 */
export function PageThumbnail({
  pageIndex,
  size,
  renderPage,
  mark,
  onToggle,
  caption,
  disabled,
}: PageThumbnailProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const near = useNearViewport(boxRef, NEAR);
  const cssWidth = useElementWidth(boxRef);
  const width = renderWidthFor(
    cssWidth,
    typeof window === "undefined" ? 1 : window.devicePixelRatio,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || width === 0) return;
    const controller = new AbortController();
    void renderPage(pageIndex, width, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status === "rendered") {
        drawPixels(canvas, result.width, result.height, result.pixels);
        setDrawn(true);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => controller.abort();
  }, [near, width, pageIndex, renderPage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas) return;
    return () => {
      // Far away now: free the bitmap and show the placeholder again.
      canvas.width = 0;
      canvas.height = 0;
      setDrawn(false);
    };
  }, [near]);

  const number = pageIndex + 1;
  // The picture is always the same elements in the same place, whether the
  // page can be clicked or not. The click target is a separate button laid
  // over it. Wrapping the picture in a <button> in one mode and a <div> in
  // another would make React replace the box and canvas on every mode
  // switch, while the observers above kept watching the old, detached box:
  // the new canvas would never be drawn.
  return (
    <li className="relative min-w-0">
      <div
        className={cn(
          "flex flex-col items-center gap-1 p-1.5",
          onToggle && disabled && "opacity-60",
        )}
        // In picking mode the button below names the page; hiding the
        // picture's number from screen readers avoids reading it twice.
        aria-hidden={onToggle ? true : undefined}
        title={error ?? undefined}
      >
        <div
          ref={boxRef}
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
          className={cn(
            "relative w-full overflow-hidden rounded-md border bg-white shadow-sm transition",
            mark === "picked" && "ring-primary ring-3",
            mark === "removed" && "ring-3 ring-red-600 dark:ring-red-500",
          )}
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cn("absolute inset-0 size-full", mark === "removed" && "opacity-30")}
          />
          {!drawn && !error && (
            <div aria-hidden="true" className="bg-muted/60 absolute inset-0 animate-pulse" />
          )}
          {error && (
            <p className="text-destructive absolute inset-0 flex items-center justify-center p-2 text-center text-xs">
              Could not show this page
            </p>
          )}
          {mark === "picked" && (
            <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full">
              <Check className="size-4" aria-hidden="true" />
            </span>
          )}
          {mark === "removed" && (
            <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-red-600 text-white">
              <X className="size-4" aria-hidden="true" />
            </span>
          )}
        </div>
        <span className="text-sm font-medium tabular-nums">{number}</span>
        {caption && <span className="text-muted-foreground text-xs">{caption}</span>}
      </div>
      {onToggle && (
        <button
          type="button"
          aria-pressed={mark !== "none"}
          aria-label={`Page ${number}`}
          title={error ?? undefined}
          disabled={disabled}
          onClick={(e) => onToggle(pageIndex, e.shiftKey)}
          className="focus-visible:ring-ring/50 hover:bg-foreground/5 absolute inset-0 rounded-lg outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        />
      )}
    </li>
  );
}
