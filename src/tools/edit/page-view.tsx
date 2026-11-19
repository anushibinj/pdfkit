"use client";

import { ArrowDown, ArrowUp, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { QuarterTurns } from "./core/model";
import { renderWidthFor } from "./core/render-width";
import type { RenderResult } from "./messages";
import { PageCanvas } from "./page-canvas";
import { PageOverlay, type PageOverlayProps } from "./page-overlay";
import { useElementWidth, useNearViewport } from "./use-element-observers";

interface PageControlsProps {
  /** 1-based position. */
  pageNumber: number;
  pageCount: number;
  disabled?: boolean;
  onRotate(delta: 1 | -1): void;
  onMove(delta: 1 | -1): void;
  onDelete(): void;
}

/**
 * Page number and the page operations: rotate either way, move up or down,
 * delete. Moving is disabled at the ends and deleting when only one page is
 * left (a PDF needs at least one page).
 *
 * @param props Position and callbacks.
 * @returns The control row.
 */
export function PageControls({
  pageNumber,
  pageCount,
  disabled,
  onRotate,
  onMove,
  onDelete,
}: PageControlsProps) {
  const n = pageNumber;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-muted-foreground text-sm font-medium">
        Page {n} of {pageCount}
      </h3>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Rotate page ${n} left`}
          disabled={disabled}
          onClick={() => onRotate(-1)}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Rotate page ${n} right`}
          disabled={disabled}
          onClick={() => onRotate(1)}
        >
          <RotateCw aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Move page ${n} up`}
          disabled={disabled || n === 1}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Move page ${n} down`}
          disabled={disabled || n === pageCount}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Delete page ${n}`}
          disabled={disabled || pageCount === 1}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export interface PageViewProps extends Omit<PageOverlayProps, "cssWidth"> {
  pageCount: number;
  /** Blocks page operations, e.g. while saving. */
  disabled?: boolean;
  renderPage(
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
  ): Promise<RenderResult>;
  onRotate(delta: 1 | -1): void;
  onMove(delta: 1 | -1): void;
  onDelete(): void;
}

/**
 * One page of the editor: its controls, the rendered original underneath
 * and the editable overlay on top.
 *
 * The overlay SVG sits in normal flow and sizes the box (its `viewBox`
 * gives the page's aspect ratio); the canvas is stretched over the same
 * box. Both describe the same displayed page, so they line up at any width.
 *
 * @param props The page, its rendering and its editing callbacks.
 * @returns The page section.
 */
export function PageView(props: PageViewProps) {
  const { pageNumber, pageCount, page, renderPage } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(boxRef);
  const cssWidth = useElementWidth(boxRef);
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return (
    <section
      aria-label={`Page ${pageNumber} of ${pageCount}`}
      className="space-y-2"
    >
      <PageControls
        pageNumber={pageNumber}
        pageCount={pageCount}
        disabled={props.disabled}
        onRotate={props.onRotate}
        onMove={props.onMove}
        onDelete={props.onDelete}
      />
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-md border bg-white shadow-sm"
      >
        <PageCanvas
          renderPage={renderPage}
          sourceIndex={page.sourceIndex}
          rotation={page.rotation}
          width={renderWidthFor(cssWidth, ratio)}
          active={near}
          className="absolute inset-0 size-full"
        />
        <PageOverlay {...props} cssWidth={cssWidth} />
      </div>
    </section>
  );
}
