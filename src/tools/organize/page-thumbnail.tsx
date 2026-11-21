"use client";

import { Check, GripVertical, RotateCw } from "lucide-react";
import {
  memo,
  useCallback,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { renderWidthFor } from "@/tools/edit/core/render-width";
import type { QuarterTurns } from "@/tools/edit/core/model";
import type { RenderOptions } from "@/tools/edit/editor-engine";
import type { RenderResult as CanvasRenderResult } from "@/tools/edit/messages";
import { PageCanvas } from "@/tools/edit/page-canvas";
import {
  useElementWidth,
  useNearViewport,
} from "@/tools/edit/use-element-observers";
import { cn } from "@/lib/utils";
import { TURN_DEGREES } from "./core/arrange";
import type { BoardPage, BoardSource } from "./core/board";
import type { Size } from "@/tools/edit/core/page-geometry";
import { sourceColor } from "./core/source-colors";
import { THUMBNAIL_RENDER_LIMITS } from "./core/zoom";
import type { RenderResult } from "./messages";

/** How far off screen a thumbnail still renders (and keeps its bitmap). */
export const THUMBNAIL_MARGIN = "600px 0px";

/** Renders a page of an open file (the organizer's `render`). */
export type ThumbnailRenderer = (
  sourceId: string,
  pageIndex: number,
  rotation: QuarterTurns,
  width: number,
  signal?: AbortSignal,
) => Promise<RenderResult>;

/**
 * Adapt an organizer render result to the shape the editor's `PageCanvas`
 * expects. The canvas also reports text-edit outcomes; thumbnails have no
 * text edits, so the list is always empty.
 *
 * @param result The organizer's result.
 * @returns The same result in the canvas's shape.
 */
export function toCanvasResult(result: RenderResult): CanvasRenderResult {
  return result.status === "rendered"
    ? { ...result, textOutcomes: [] }
    : result;
}

/**
 * The accessible name of a board page: its position, where it comes from
 * and how it is turned, e.g. "Page 3: report.pdf, page 2, turned 90°".
 * The file name matters because colour alone must not carry it.
 *
 * @param page The board page.
 * @param position 1-based position on the board.
 * @param source Its file (`undefined` for blank pages).
 * @returns The label.
 */
export function thumbnailLabel(
  page: BoardPage,
  position: number,
  source: BoardSource | undefined,
): string {
  const origin =
    page.kind === "blank"
      ? "blank page"
      : `${source?.name ?? "unknown file"}, page ${page.pageIndex + 1}`;
  const turn =
    page.rotation === 0 ? "" : `, turned ${TURN_DEGREES[page.rotation]}°`;
  return `Page ${position}: ${origin}${turn}`;
}

/** A page's shape as primitives, so memoised thumbnails can compare it. */
export interface ThumbnailShape {
  /** CSS `aspect-ratio`, e.g. "612 / 792"; `null` when the size is unknown. */
  aspectRatio: string | null;
  /** Wider than tall: the sheet fills the frame's width, not its height. */
  landscape: boolean;
}

/**
 * Describe a displayed page size as the thumbnail's shape.
 *
 * Plain strings and booleans compare by value, unlike a `Size` object
 * (computed afresh on every board render), so `memo` can skip a thumbnail
 * whose shape did not change.
 *
 * @param size Displayed width and height in points, or `null`.
 * @returns The shape.
 */
export function shapeOf(size: Size | null): ThumbnailShape {
  return size
    ? {
        aspectRatio: `${size.width} / ${size.height}`,
        landscape: size.width > size.height,
      }
    : { aspectRatio: null, landscape: false };
}

/** No text edits on thumbnails (a constant, so `PageCanvas` never re-renders for it). */
const NO_TEXT_EDITS = [] as const;

export interface PageThumbnailProps extends ThumbnailShape {
  page: BoardPage;
  /** 0-based position on the board. */
  index: number;
  /** The page's file (`undefined` for blank pages). */
  source: BoardSource | undefined;
  /** 1-based number of the file, shown on the page. */
  fileNumber: number;
  selected: boolean;
  /** The one card that is in the Tab order (roving tabindex). */
  tabbable: boolean;
  /** The card is being dragged (shown faded). */
  dragging: boolean;
  /** Where the drop indicator is: before this card, after it, or neither. */
  dropMark: "before" | "after" | null;
  render: ThumbnailRenderer;
  onPointerDown(event: PointerEvent<HTMLElement>, key: string): void;
  onClick(event: MouseEvent<HTMLElement>, key: string): void;
  onFocus(key: string): void;
}

/**
 * One page on the board: the rendered page (or a blank sheet) in a square
 * frame, its position, its file's number and colour, and a tick that shows
 * (and, on touch screens, toggles) whether it is selected.
 *
 * The card is a listbox option: the board handles the keyboard. The tick
 * and the grip are decoration for assistive technology (`aria-hidden`);
 * their jobs (toggling, dragging) are also done by Space and Ctrl/Cmd +
 * arrow keys.
 *
 * The page bitmap is rendered by PDFium only while the card is near the
 * screen, at the card's own width in device pixels, and released when it
 * scrolls far away (all by the editor's `PageCanvas`).
 *
 * It is memoised: every prop is a primitive or keeps its identity while
 * unchanged (the board passes stable callbacks and the shape as strings),
 * so a drag, a selection change or rotating one page re-renders only the
 * thumbnails that actually changed, not the whole board.
 *
 * @param props The page and its state.
 * @returns The card.
 */
export const PageThumbnail = memo(function PageThumbnail(
  props: PageThumbnailProps,
) {
  const { page, index, source, render, landscape } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(sheetRef, THUMBNAIL_MARGIN);
  const cssWidth = useElementWidth(sheetRef);
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const sourceId = page.kind === "source" ? page.sourceId : "";
  const renderPage = useCallback(
    (
      pageIndex: number,
      rotation: QuarterTurns,
      width: number,
      options?: RenderOptions,
    ) =>
      render(sourceId, pageIndex, rotation, width, options?.signal).then(
        toCanvasResult,
      ),
    [render, sourceId],
  );
  const color = sourceColor(source?.colorIndex ?? 0);

  return (
    <div
      role="option"
      aria-selected={props.selected}
      aria-label={thumbnailLabel(page, index + 1, source)}
      tabIndex={props.tabbable ? 0 : -1}
      data-board-index={index}
      data-key={page.key}
      onPointerDown={(e) => props.onPointerDown(e, page.key)}
      onClick={(e) => props.onClick(e, page.key)}
      onFocus={() => props.onFocus(page.key)}
      className={cn(
        "group bg-card relative flex cursor-grab flex-col gap-2 rounded-lg border-2 p-2 outline-none select-none",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
        props.selected
          ? "border-primary bg-primary/5"
          : "hover:border-muted-foreground/40 border-transparent",
        props.dragging && "opacity-40",
      )}
    >
      {props.dropMark && (
        <span
          aria-hidden="true"
          data-testid="drop-indicator"
          className={cn(
            "bg-primary absolute top-0 bottom-0 z-10 w-1 rounded-full",
            props.dropMark === "before" ? "-left-2" : "-right-2",
          )}
        />
      )}
      <div className="bg-muted/50 relative flex aspect-square items-center justify-center overflow-hidden rounded-md p-1">
        <div
          ref={sheetRef}
          className={cn(
            "relative bg-white shadow-sm ring-1 ring-black/10",
            landscape ? "w-full" : "h-full",
          )}
          style={{
            aspectRatio: props.aspectRatio ?? "1 / 1.414",
          }}
        >
          {page.kind === "source" && (
            <PageCanvas
              renderPage={renderPage}
              sourceIndex={page.pageIndex}
              rotation={page.rotation}
              width={renderWidthFor(cssWidth, ratio, THUMBNAIL_RENDER_LIMITS)}
              textEdits={NO_TEXT_EDITS}
              active={near}
              className="absolute inset-0 size-full"
            />
          )}
        </div>
        <span
          aria-hidden="true"
          data-toggle=""
          className={cn(
            "absolute top-1 left-1 flex size-7 items-center justify-center rounded-full border-2 shadow-sm",
            props.selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/50 bg-background/90 text-transparent opacity-70 group-hover:opacity-100",
          )}
        >
          <Check className="size-4" />
        </span>
        <span
          aria-hidden="true"
          data-drag-handle=""
          className="bg-background/90 text-muted-foreground absolute top-1 right-1 flex size-7 touch-none items-center justify-center rounded-md shadow-sm"
        >
          <GripVertical className="size-4" />
        </span>
      </div>
      <div
        className="flex min-w-0 items-center gap-1.5 text-xs"
        aria-hidden="true"
      >
        {page.kind === "source" ? (
          <span
            className={cn(
              "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-semibold",
              color.fill,
              color.onFill,
            )}
          >
            {props.fileNumber}
          </span>
        ) : (
          <span className="border-muted-foreground/60 inline-flex h-5 shrink-0 items-center rounded border border-dashed px-1">
            Blank
          </span>
        )}
        <span className="font-medium tabular-nums">{index + 1}</span>
        {page.kind === "source" && (
          <span className="text-muted-foreground truncate">
            p.{page.pageIndex + 1}
          </span>
        )}
        {page.rotation !== 0 && (
          <span className="text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-0.5">
            <RotateCw className="size-3" />
            {TURN_DEGREES[page.rotation]}°
          </span>
        )}
      </div>
    </div>
  );
});
