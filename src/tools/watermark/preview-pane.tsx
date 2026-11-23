"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { drawPixels } from "@/lib/draw-pixels";
import { cn } from "@/lib/utils";
import type { WatermarkSettings } from "./core/model";
import type { PreviewResult } from "./messages";

/** Wait this long after the last change before asking for a preview. */
export const PREVIEW_DELAY_MS = 250;

/** Widest preview bitmap requested, in pixels. */
export const MAX_PREVIEW_WIDTH = 1600;

/**
 * Bitmap width for a preview shown `cssWidth` pixels wide: sharp on high
 * density screens (device pixels), capped so a big monitor does not ask
 * for a huge render.
 *
 * @param cssWidth The canvas's layout width in CSS pixels.
 * @param pixelRatio `window.devicePixelRatio` (1 when unknown).
 * @returns Whole pixels, between 1 and {@link MAX_PREVIEW_WIDTH}.
 */
export function previewWidth(cssWidth: number, pixelRatio: number): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.min(MAX_PREVIEW_WIDTH, Math.max(1, Math.round(cssWidth * ratio)));
}

interface PreviewPaneProps {
  pageCount: number;
  pageIndex: number;
  onPageChange(pageIndex: number): void;
  /** The watermark for this page, or `undefined` if it gets none. */
  settings: WatermarkSettings | undefined;
  /** Renders a page as the download will show it. */
  preview(
    pageIndex: number,
    width: number,
    settings: WatermarkSettings | undefined,
    signal?: AbortSignal,
  ): Promise<PreviewResult>;
}

/**
 * A live preview of one page, rendered by the worker exactly as the
 * download will contain it, with buttons to move between pages.
 *
 * Settings change faster than pages render (dragging a slider), so:
 * 1. a change starts a short timer ({@link PREVIEW_DELAY_MS}); only the
 *    last change of a burst asks for a preview;
 * 2. each request has an AbortController; a newer change aborts it, so a
 *    queued request is skipped by the engine and a late answer is ignored
 *    (an old render can never paint over a newer one);
 * 3. the old bitmap stays on screen until the new one replaces it in one
 *    step, so the preview never flashes empty.
 * The canvas's layout width is watched with a ResizeObserver, so the
 * bitmap stays sharp when the window is resized or the device rotated.
 *
 * @param props Page navigation, settings and the preview function.
 * @returns The preview.
 */
export function PreviewPane({
  pageCount,
  pageIndex,
  onPageChange,
  settings,
  preview,
}: PreviewPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [cssWidth, setCssWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setCssWidth(box.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setCssWidth(entry.contentRect.width),
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssWidth <= 0) return;
    const controller = new AbortController();
    const width = previewWidth(cssWidth, window.devicePixelRatio);
    setBusy(true);
    const timer = setTimeout(() => {
      preview(pageIndex, width, settings, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        if (result.status === "rendered") {
          drawPixels(canvas, result.width, result.height, result.pixels);
          setDrawn(true);
          setError(null);
        } else {
          setError(result.message);
        }
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [preview, pageIndex, settings, cssWidth]);

  return (
    <section aria-label="Preview" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Previous page"
          disabled={pageIndex <= 0}
          onClick={() => onPageChange(pageIndex - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p className="text-sm" aria-live="polite">
          Page {pageIndex + 1} of {pageCount}
          {/* Hidden from screen readers: this live region announces page
              changes, and "updating" on every slider move would be noise. */}
          {busy && (
            <span aria-hidden="true" className="text-muted-foreground">
              {" "}
              · updating…
            </span>
          )}
        </p>
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Next page"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onPageChange(pageIndex + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      {!settings && (
        <p className="text-muted-foreground text-sm">
          This page is not watermarked with the current settings.
        </p>
      )}
      <div ref={boxRef} className="bg-muted/30 relative rounded-lg border p-2">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Preview of page ${pageIndex + 1}`}
          // A failed render leaves the previous bitmap in place; dim it so
          // it is not mistaken for a preview of the current settings.
          className={cn(
            "mx-auto block h-auto w-full bg-white shadow-sm transition-opacity",
            error && "opacity-30",
          )}
          width={0}
          height={0}
        />
        {!drawn && !error && (
          <p className="text-muted-foreground p-8 text-center text-sm">
            Rendering the preview… The first time, the PDF engines (about 6 MB)
            are downloaded, so it takes a little longer.
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive p-4 text-center text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
