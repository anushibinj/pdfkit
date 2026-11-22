"use client";

import { useEffect, useRef, useState } from "react";
import type { QuarterTurns, TextEdit, TextEditOutcome } from "./core/model";
import type { RenderOptions } from "./editor-engine";
import type { RenderResult } from "./messages";
import { drawPixels } from "@/lib/draw-pixels";
import { cn } from "@/lib/utils";

interface PageCanvasProps {
  renderPage(
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
    options?: RenderOptions,
  ): Promise<RenderResult>;
  sourceIndex: number;
  /** User quarter turns (the bitmap is rendered already turned). */
  rotation: QuarterTurns;
  /** Bitmap width in device pixels. */
  width: number;
  /** Changes to the page's own text, shown in the render. */
  textEdits: readonly TextEdit[];
  /** Render only while true; the bitmap is released when it turns false. */
  active: boolean;
  /** Told what happened to each text edit after every successful render. */
  onTextOutcomes?(
    edits: readonly TextEdit[],
    outcomes: TextEditOutcome[],
  ): void;
  className?: string;
}

/**
 * The page, as rendered by PDFium in the worker, with its text edits.
 *
 * Lifecycle: whenever the page becomes active, or its rotation, width or
 * text edits change, a render is requested. When the inputs change again
 * or the page scrolls away, that request is aborted: the engine skips it if
 * it is still queued, and a result that arrives anyway is dropped, so a
 * slow old render can never paint over a newer one.
 *
 * The bitmap on screen stays until the new one replaces it in a single
 * step (`drawPixels`), so editing text never flashes an empty page. It is
 * cleared only when it can no longer be right: when the page scrolls far
 * away (shrinking the canvas to 0 x 0 also frees its memory) or turns, or
 * the slot shows another page.
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
  textEdits,
  active,
  onTextOutcomes,
  className,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edits arrive as a new array on every parent render; compare by content
  // so an unchanged list does not trigger a new render.
  const editsKey = JSON.stringify(textEdits);
  const latest = useRef({ textEdits, onTextOutcomes });
  useEffect(() => {
    latest.current = { textEdits, onTextOutcomes };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    // Aborting tells the engine to skip this render if it is still queued,
    // and tells the callback below to ignore a result that arrives anyway.
    const controller = new AbortController();
    const edits = latest.current.textEdits;
    renderPage(sourceIndex, rotation, width, {
      signal: controller.signal,
      textEdits: [...edits],
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status === "rendered") {
        drawPixels(canvas, result.width, result.height, result.pixels);
        setDrawn(true);
        setError(null);
        latest.current.onTextOutcomes?.(edits, result.textOutcomes);
      } else {
        setError(result.message);
      }
    });
    return () => controller.abort();
  }, [active, renderPage, sourceIndex, rotation, width, editsKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    return () => {
      // The bitmap no longer matches: release it and show the placeholder.
      canvas.width = 0;
      canvas.height = 0;
      setDrawn(false);
    };
  }, [active, sourceIndex, rotation]);

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
