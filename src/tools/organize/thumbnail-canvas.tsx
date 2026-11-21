"use client";

import { useEffect, useRef, useState } from "react";
import { drawPixels } from "@/lib/draw-pixels";
import type { QuarterTurns } from "@/lib/pdfium/page-box";
import { cn } from "@/lib/utils";
import type { RenderResult } from "./messages";

/** Renders a page of an open file (the organizer's `render`). */
export type ThumbnailRenderer = (
  sourceId: string,
  pageIndex: number,
  rotation: QuarterTurns,
  width: number,
  signal?: AbortSignal,
) => Promise<RenderResult>;

interface ThumbnailCanvasProps {
  render: ThumbnailRenderer;
  sourceId: string;
  pageIndex: number;
  /** User quarter turns (the bitmap is rendered already turned). */
  rotation: QuarterTurns;
  /** Bitmap width in device pixels (0 while the size is unknown). */
  width: number;
  /** Render only while true; the bitmap is released when it turns false. */
  active: boolean;
  className?: string;
}

/**
 * A page of an open file, rendered by PDFium in the worker.
 *
 * Lifecycle:
 * - While `active` (near the screen) and the width is known, a render is
 *   requested. When the inputs change again, or the page scrolls away,
 *   that request is aborted: the engine skips it if it is still queued,
 *   and an answer that arrives anyway is dropped, so a slow old render can
 *   never paint over a newer one.
 * - The bitmap on screen stays until the new one replaces it in one step,
 *   so changing the zoom never flashes an empty page. It is released only
 *   when it can no longer be right: when the page scrolls far away
 *   (shrinking the canvas to 0 x 0 also frees its memory), turns, or the
 *   slot shows another page.
 *
 * @param props What to render and how wide.
 * @returns A canvas stretched to its container, with a loading or error
 *   hint until the first render succeeds.
 */
export function ThumbnailCanvas({
  render,
  sourceId,
  pageIndex,
  rotation,
  width,
  active,
  className,
}: ThumbnailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas || width <= 0) return;
    const controller = new AbortController();
    void render(sourceId, pageIndex, rotation, width, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === "rendered") {
          drawPixels(canvas, result.width, result.height, result.pixels);
          setDrawn(true);
          setError(null);
        } else {
          setError(result.message);
        }
      },
    );
    return () => controller.abort();
  }, [active, render, sourceId, pageIndex, rotation, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    return () => {
      // The bitmap no longer matches: release it and show the placeholder.
      canvas.width = 0;
      canvas.height = 0;
      setDrawn(false);
    };
  }, [active, sourceId, pageIndex, rotation]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn("bg-white", className)}
      />
      {!drawn && !error && (
        <div
          aria-hidden="true"
          className={cn("bg-muted/60 animate-pulse", className)}
        />
      )}
      {error && (
        <p
          role="alert"
          className={cn(
            "text-destructive flex items-center justify-center p-2 text-center text-xs",
            className,
          )}
        >
          Could not show this page: {error}
        </p>
      )}
    </>
  );
}
