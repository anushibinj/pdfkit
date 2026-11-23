"use client";

/**
 * Side-by-side Original vs Compressed page preview panel.
 *
 * Follows Single Responsibility Principle (SRP) by painting RGBA pixel pairs
 * onto two synchronized canvases and handling page navigation controls.
 */

import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { drawPixels } from "@/lib/draw-pixels";
import { formatBytes } from "@/lib/format";
import { toTransferableBuffer } from "@/lib/transfer";
import type { PreviewState } from "./compress-state";
import { formatReductionPercent } from "./core/report";

export interface SideBySidePreviewProps {
  fileName: string;
  originalBytes: number;
  compressedBytes: number;
  preview: PreviewState;
  onPageChange(pageIndex: number): void;
  onClose(): void;
}

/**
 * Renders an interactive side-by-side comparison of Original (left) vs
 * Compressed (right) page renderings so users can inspect visual fidelity
 * before downloading.
 *
 * @param props Preview pixels, file byte stats, and navigation callbacks.
 * @returns Side-by-side preview card.
 */
export function SideBySidePreview({
  fileName,
  originalBytes,
  compressedBytes,
  preview,
  onPageChange,
  onClose,
}: SideBySidePreviewProps) {
  const origCanvasRef = useRef<HTMLCanvasElement>(null);
  const compCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (
      preview.loading ||
      !preview.originalPixels ||
      !preview.compressedPixels ||
      preview.width <= 0 ||
      preview.height <= 0
    ) {
      return;
    }
    if (origCanvasRef.current) {
      drawPixels(
        origCanvasRef.current,
        preview.width,
        preview.height,
        toTransferableBuffer(preview.originalPixels),
      );
    }
    if (compCanvasRef.current) {
      drawPixels(
        compCanvasRef.current,
        preview.width,
        preview.height,
        toTransferableBuffer(preview.compressedPixels),
      );
    }
  }, [preview]);

  const pct = formatReductionPercent(originalBytes, compressedBytes);
  const pageNumber = preview.pageIndex + 1;

  return (
    <section
      aria-label="Side-by-side page preview"
      className="space-y-4 rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            Side-by-side preview: {fileName}
          </h3>
          <p className="text-muted-foreground text-xs">
            Page {pageNumber} of {preview.pageCount} ·{" "}
            {formatBytes(originalBytes)} → {formatBytes(compressedBytes)} (
            {pct}% smaller)
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Previous preview page"
            disabled={preview.loading || preview.pageIndex <= 0}
            onClick={() => onPageChange(preview.pageIndex - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Next preview page"
            disabled={preview.loading || pageNumber >= preview.pageCount}
            onClick={() => onPageChange(preview.pageIndex + 1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Close preview"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {preview.error ? (
        <p role="alert" className="text-destructive text-sm">
          Could not render preview: {preview.error}
        </p>
      ) : (
        <div className="relative grid gap-4 sm:grid-cols-2">
          <figure className="space-y-1.5">
            <figcaption className="flex items-center justify-between text-xs font-medium">
              <span>Original</span>
              <span className="text-muted-foreground">
                {formatBytes(originalBytes)}
              </span>
            </figcaption>
            <div className="overflow-hidden rounded-lg border bg-white">
              <canvas
                ref={origCanvasRef}
                aria-label="Original page render"
                className="block h-auto w-full"
              />
            </div>
          </figure>

          <figure className="space-y-1.5">
            <figcaption className="flex items-center justify-between text-xs font-medium">
              <span>Compressed</span>
              <span className="text-emerald-700 dark:text-emerald-400">
                {formatBytes(compressedBytes)}
              </span>
            </figcaption>
            <div className="overflow-hidden rounded-lg border bg-white">
              <canvas
                ref={compCanvasRef}
                aria-label="Compressed page render"
                className="block h-auto w-full"
              />
            </div>
          </figure>

          {preview.loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[1px]">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Rendering page {pageNumber}…
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
