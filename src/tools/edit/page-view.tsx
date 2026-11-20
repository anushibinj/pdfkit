"use client";

import { ArrowDown, ArrowUp, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { QuarterTurns, TextEdit, TextEditOutcome } from "./core/model";
import { renderWidthFor } from "./core/render-width";
import type { RenderOptions } from "./editor-engine";
import type { RenderResult, TextRunsResult } from "./messages";
import { PageCanvas } from "./page-canvas";
import { PageOverlay, type PageOverlayProps } from "./page-overlay";
import { useElementWidth, useNearViewport } from "./use-element-observers";
import { useTextRuns } from "./use-text-runs";

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

export interface PageViewProps extends Omit<
  PageOverlayProps,
  "cssWidth" | "textRuns" | "editingRunId" | "onEditRun"
> {
  pageCount: number;
  /** Blocks page operations, e.g. while saving. */
  disabled?: boolean;
  renderPage(
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
    options?: RenderOptions,
  ): Promise<RenderResult>;
  /** Fetches the editable lines of a page of the original file. */
  loadTextRuns(pageIndex: number): Promise<TextRunsResult>;
  /** Told what happened to the page's text edits after each render. */
  onTextOutcomes(
    edits: readonly TextEdit[],
    outcomes: readonly TextEditOutcome[],
  ): void;
  onRotate(delta: 1 | -1): void;
  onMove(delta: 1 | -1): void;
  onDelete(): void;
}

/**
 * The text edits to render: every stored edit, except that the line being
 * typed into is rendered empty. The inline field then shows the only copy
 * of that line, instead of a field drawn over the old glyphs.
 *
 * @param stored The page's stored edits, by line id.
 * @param editingRunId The line being edited, if any.
 * @returns The edits, in a stable order.
 */
export function editsToRender(
  stored: Readonly<Record<string, string>>,
  editingRunId: string | null,
): TextEdit[] {
  const edits = Object.entries(stored)
    .filter(([runId]) => runId !== editingRunId)
    .map(([runId, text]) => ({ runId, text }));
  if (editingRunId !== null) edits.push({ runId: editingRunId, text: "" });
  return edits;
}

/**
 * One page of the editor: its controls, the rendered page underneath and
 * the editable overlay on top.
 *
 * The overlay SVG sits in normal flow and sizes the box (its `viewBox`
 * gives the page's aspect ratio); the canvas is stretched over the same
 * box. Both describe the same displayed page, so they line up at any width.
 *
 * It also owns in-place editing of the page's own text: it loads the
 * lines while the Edit text tool is on (and the page is near the screen),
 * remembers which line is being typed into, and renders the page with the
 * stored edits and that line hidden (see {@link editsToRender}).
 *
 * @param props The page, its rendering and its editing callbacks.
 * @returns The page section.
 */
export function PageView(props: PageViewProps) {
  const { pageNumber, pageCount, page, renderPage, tool } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(boxRef);
  const cssWidth = useElementWidth(boxRef);
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const editingText = tool === "edit-text";
  const { runs, error } = useTextRuns(
    props.loadTextRuns,
    page.sourceIndex,
    editingText && near,
  );
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  // Leaving the tool ends editing (the field has committed on blur by
  // then). Reset during render, React's pattern for state that follows a
  // prop, so coming back to the tool never reopens an old field.
  const [wasEditingText, setWasEditingText] = useState(editingText);
  if (wasEditingText !== editingText) {
    setWasEditingText(editingText);
    if (!editingText) setEditingRunId(null);
  }
  const activeRunId = editingText ? editingRunId : null;
  const textEdits = useMemo(
    () => editsToRender(page.textEdits, activeRunId),
    [page.textEdits, activeRunId],
  );

  useEffect(() => {
    if (error)
      toast.error(`Could not read the text of page ${pageNumber}: ${error}`);
  }, [error, pageNumber]);

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
          textEdits={textEdits}
          active={near}
          onTextOutcomes={props.onTextOutcomes}
          className="absolute inset-0 size-full"
        />
        <PageOverlay
          {...props}
          cssWidth={cssWidth}
          textRuns={runs}
          editingRunId={activeRunId}
          onEditRun={setEditingRunId}
        />
      </div>
    </section>
  );
}
