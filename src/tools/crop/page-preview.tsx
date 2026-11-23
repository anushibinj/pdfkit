"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { drawPixels } from "@/lib/draw-pixels";
import { viewSize } from "@/lib/pdfium/page-box";
import type { PageInfo } from "@/lib/pdfium/pdfium-document";
import { renderWidthFor } from "@/lib/render-width";
import { useElementWidth } from "@/lib/use-element-observers";
import { CropOverlay } from "./crop-overlay";
import {
  cropRectInView,
  marginsFromViewRect,
  validateMargins,
  type Margins,
} from "./core/margins";
import type { RenderResult } from "./messages";

/** Tallest the page may be drawn, as a share of the window height. */
export const MAX_PREVIEW_HEIGHT_VH = 70;

export interface PagePreviewProps {
  /** 0-based page shown. */
  pageIndex: number;
  pageCount: number;
  info: PageInfo;
  renderPage(
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult>;
  margins: Margins;
  onMarginsChange(margins: Margins): void;
  onPageChange(pageIndex: number): void;
  /** Blocks dragging and page changes, e.g. while cropping. */
  disabled?: boolean;
}

/**
 * One page as it is displayed, with the crop area over it, and buttons to
 * show the previous or next page.
 *
 * The page box keeps the page's aspect ratio (no taller than
 * {@link MAX_PREVIEW_HEIGHT_VH} of the window); the canvas fills it and is
 * rendered at the box's width in device pixels. Whenever the page or the
 * width changes, a new render is asked for and the previous one aborted,
 * so a slow old render never paints over a newer one. Dragging the crop
 * area changes the margins, which are shared by every page.
 *
 * @param props The page, its rendering and the margins.
 * @returns The preview section.
 */
export function PagePreview({
  pageIndex,
  pageCount,
  info,
  renderPage,
  margins,
  onMarginsChange,
  onPageChange,
  disabled,
}: PagePreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssWidth = useElementWidth(boxRef);
  const [error, setError] = useState<string | null>(null);
  const view = viewSize(info.box, info.rotation);
  const rect = cropRectInView(view, margins);
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

  const n = pageIndex + 1;
  return (
    <section aria-label="Page preview" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-sm font-medium">
          Page {n} of {pageCount}
        </h2>
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
            disabled={disabled || n === pageCount}
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
        <CropOverlay
          view={view}
          rect={rect}
          cssWidth={cssWidth}
          disabled={disabled}
          onChange={(next) => onMarginsChange(marginsFromViewRect(view, next))}
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          Could not show this page: {error}
        </p>
      )}
      {!rect && (
        <p role="alert" className="text-destructive text-sm">
          {validateMargins(margins)?.message ??
            "The margins leave nothing to keep on this page."}
        </p>
      )}
    </section>
  );
}
