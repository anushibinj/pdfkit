"use client";

import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  FilePlus2,
  ListRestart,
  Redo2,
  RectangleVertical,
  RotateCcw,
  RotateCw,
  Shuffle,
  SquareDashed,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArrangeKind, BoardAction } from "./core/board-state";
import { ZOOM_LEVELS } from "./core/zoom";

/** What the toolbar needs to know to enable and label its buttons. */
export interface ToolbarState {
  pageCount: number;
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  /** For each arrange action: does it apply to the selection only? */
  arrangeOnSelection: Record<ArrangeKind, boolean>;
  zoom: number;
  saving: boolean;
}

interface BoardToolbarProps extends ToolbarState {
  /** Board actions (undo, rotate, interleave...). */
  onAction(action: BoardAction): void;
  /** PDFs picked with "Add PDFs". */
  onAddFiles(files: File[]): void;
  onZoom(delta: 1 | -1): void;
  onDownload(): void;
  onStartOver(): void;
}

/** One toolbar button's look and behaviour. */
interface ToolButton {
  label: string;
  /** Tooltip; defaults to the label. */
  title?: string;
  icon: LucideIcon;
  disabled: boolean;
  onClick(): void;
  /** Show the label next to the icon on wide screens. */
  wide?: boolean;
}

/**
 * The label of an arrange button for its current scope.
 *
 * @param verb The action, e.g. "Reverse".
 * @param onSelection Whether it applies to the selection only.
 * @returns "Reverse selected" or "Reverse all".
 */
export function scopedLabel(verb: string, onSelection: boolean): string {
  return `${verb} ${onSelection ? "selected" : "all"}`;
}

/**
 * Render a group of icon buttons. Labels are visible on wide screens for
 * `wide` buttons only; every button keeps its accessible name.
 *
 * @param props Group name and buttons.
 * @returns A toolbar group.
 */
function ButtonGroup({
  label,
  buttons,
}: {
  label: string;
  buttons: ToolButton[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {buttons.map((b) => (
        <Button
          key={b.label}
          variant="ghost"
          className={cn("min-h-11 min-w-11", !b.wide && "px-0")}
          aria-label={b.label}
          title={b.title ?? b.label}
          disabled={b.disabled}
          onClick={b.onClick}
        >
          <b.icon aria-hidden="true" />
          {b.wide && <span className="hidden lg:inline">{b.label}</span>}
        </Button>
      ))}
    </div>
  );
}

/**
 * The organizer's toolbar: add files, history, actions on the selected
 * pages, arrangements, zoom, start over and download.
 *
 * Selection actions are disabled with nothing selected; Delete also when
 * every page is selected (the output needs at least one page). Everything
 * is disabled while the file is being saved.
 *
 * @param props State flags and callbacks.
 * @returns The toolbar.
 */
export function BoardToolbar(props: BoardToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = props.saving;
  const none = busy || props.selectedCount === 0;
  const act = (action: BoardAction) => () => props.onAction(action);
  const scope = props.arrangeOnSelection;

  const history: ToolButton[] = [
    {
      label: "Undo",
      title: "Undo (Ctrl+Z)",
      icon: Undo2,
      disabled: busy || !props.canUndo,
      onClick: act({ type: "undo" }),
    },
    {
      label: "Redo",
      title: "Redo (Ctrl+Shift+Z)",
      icon: Redo2,
      disabled: busy || !props.canRedo,
      onClick: act({ type: "redo" }),
    },
  ];
  const selection: ToolButton[] = [
    {
      label: "Rotate left",
      icon: RotateCcw,
      disabled: none,
      onClick: act({ type: "rotate", delta: -1 }),
    },
    {
      label: "Rotate right",
      icon: RotateCw,
      disabled: none,
      onClick: act({ type: "rotate", delta: 1 }),
    },
    {
      label: "Move earlier",
      title: "Move earlier (Ctrl+Left)",
      icon: ArrowLeft,
      disabled: none,
      onClick: act({ type: "move-by", delta: -1 }),
    },
    {
      label: "Move later",
      title: "Move later (Ctrl+Right)",
      icon: ArrowRight,
      disabled: none,
      onClick: act({ type: "move-by", delta: 1 }),
    },
    {
      label: "Duplicate",
      icon: Copy,
      disabled: none,
      onClick: act({ type: "duplicate" }),
    },
    {
      label: "Delete",
      title: "Delete (Del)",
      icon: Trash2,
      disabled: none || props.selectedCount >= props.pageCount,
      onClick: act({ type: "delete" }),
    },
    {
      label: "Insert blank page",
      title: "Insert a blank page after the selection (or at the end)",
      icon: SquareDashed,
      disabled: busy || props.pageCount === 0,
      onClick: act({ type: "insert-blank" }),
    },
  ];
  const arrange: ToolButton[] = [
    {
      label: scopedLabel("Interleave", scope.interleave),
      title:
        "Interleave a double-sided scan: fronts in order, then backs in reverse order",
      icon: Shuffle,
      disabled: busy || props.pageCount < 3,
      onClick: act({ type: "interleave" }),
      wide: true,
    },
    {
      label: scopedLabel("Reverse", scope.reverse),
      icon: ArrowDownUp,
      disabled: busy || props.pageCount < 2,
      onClick: act({ type: "reverse" }),
      wide: true,
    },
    {
      label: scopedLabel("Make portrait", scope["turn-landscape"]),
      title: "Turn landscape pages upright (portrait)",
      icon: RectangleVertical,
      disabled: busy || props.pageCount === 0,
      onClick: act({ type: "turn-landscape" }),
      wide: true,
    },
  ];
  const view: ToolButton[] = [
    {
      label: "Smaller thumbnails",
      icon: ZoomOut,
      disabled: props.zoom <= 0,
      onClick: () => props.onZoom(-1),
    },
    {
      label: "Larger thumbnails",
      icon: ZoomIn,
      disabled: props.zoom >= ZOOM_LEVELS.length - 1,
      onClick: () => props.onZoom(1),
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Organize pages"
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <Button
        variant="outline"
        className="min-h-11"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
      >
        <FilePlus2 aria-hidden="true" />
        Add PDFs
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="add-files-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // allow picking the same files again
          if (files.length > 0) props.onAddFiles(files);
        }}
      />
      <ButtonGroup label="History" buttons={history} />
      <ButtonGroup label="Selected pages" buttons={selection} />
      <ButtonGroup label="Arrange" buttons={arrange} />
      <ButtonGroup label="Thumbnail size" buttons={view} />
      <div className="ml-auto flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Start over"
          title="Start over"
          disabled={busy}
          onClick={props.onStartOver}
        >
          <ListRestart aria-hidden="true" />
        </Button>
        <Button
          className="min-h-11"
          disabled={busy || props.pageCount === 0}
          onClick={props.onDownload}
        >
          <Download aria-hidden="true" />
          {busy ? "Saving…" : "Download PDF"}
        </Button>
      </div>
    </div>
  );
}
