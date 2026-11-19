"use client";

import { useEffect, useRef, useState } from "react";
import type { QuarterTurns } from "./core/model";
import type { RenderResult } from "./messages";
import { cn } from "@/lib/utils";

/**
 * Paint RGBA pixels onto a canvas, resizing it to match.
 *
 * Setting `width`/`height` also clears the canvas, so no old content
 * survives. Without a 2D context (jsdom, or a browser that refuses one for
 * memory reasons) nothing is drawn.
 *
 * @param canvas The target canvas.
 * @param width Bitmap width in pixels.
 * @param height Bitmap height in pixels.
 * @param pixels RGBA data, width * height * 4 bytes.
 */
export function drawPixels(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixels: ArrayBuffer,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
}

interface PageCanvasProps {
  renderPage(
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult>;
  sourceIndex: number;
  /** User quarter turns (the bitmap is rendered already turned). */
  rotation: QuarterTurns;
  /** Bitmap width in device pixels. */
  width: number;
  /** Render only while true; the bitmap is released when it turns false. */
  active: boolean;
  className?: string;
}

/**
 * The original page, as rendered by PDFium in the worker.
 *
 * Lifecycle: whenever the page becomes active, or its rotation or width
 * changes, a render is requested. When the inputs change again or the page
 * scrolls away, that request is aborted: the engine skips it if it is still
 * queued, and a result that arrives anyway is dropped, so a slow old render
 * can never paint over a newer one. When the page scrolls far away, the
 * canvas is shrunk to 0 x 0, which frees its memory.
 *
 * @param props What to render and how wide.
 * @returns A canvas stretched to its container, with a loading or error
 *   hint until the first render succeeds.
 */
export function PageCanvas({
  renderPage,
  sourceIndex,
  rotation,
  width,
  active,
  className,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    // Aborting tells the engine to skip this render if it is still queued,
    // and tells the callback below to ignore a result that arrives anyway.
    const controller = new AbortController();
    renderPage(sourceIndex, rotation, width, controller.signal).then(
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
    return () => {
      controller.abort();
      // Release the bitmap's memory while the page is off screen.
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [active, renderPage, sourceIndex, rotation, width]);

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
            "text-destructive flex items-center justify-center p-4 text-center text-sm",
            className,
          )}
        >
          Could not show this page: {error}
        </p>
      )}
    </>
  );
}
