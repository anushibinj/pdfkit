"use client";

import {
  Download,
  Eraser,
  FolderOpen,
  Highlighter,
  ImagePlus,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { IMAGE_ACCEPT } from "./core/image-info";
import type { DrawingTool } from "./core/gestures";

/** Toolbar entries for the pointer tools, in display order. */
export const TOOLS: readonly {
  id: DrawingTool;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "text", label: "Text", icon: Type },
  { id: "ink", label: "Draw", icon: Pencil },
  { id: "rect", label: "Box", icon: Square },
  { id: "highlight", label: "Highlight", icon: Highlighter },
  { id: "whiteout", label: "White-out", icon: Eraser },
];

interface EditorToolbarProps {
  tool: DrawingTool;
  onToolChange(tool: DrawingTool): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** Called with the image file the user picked. */
  onPickImage(file: File): void;
  onDownload(): void;
  onClose(): void;
  saving: boolean;
}

/**
 * The editor's main toolbar: pointer tools, then image insertion and
 * undo/redo, then opening another file and downloading the result. Everything but closing is
 * disabled while the edited file is being produced.
 *
 * Labels are hidden on narrow screens to save room, but every button keeps
 * an accessible name.
 *
 * @param props Current tool, history flags and callbacks.
 * @returns The toolbar.
 */
export function EditorToolbar(props: EditorToolbarProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const busy = props.saving;
  return (
    // Three groups that wrap independently: on a phone the drawing tools
    // fill the first row and everything else shares the second; on wider
    // screens all three fit on one row.
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div
        role="toolbar"
        aria-label="Editing tools"
        className="flex flex-wrap items-center gap-1"
      >
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={props.tool === id ? "secondary" : "ghost"}
            className="min-h-11 min-w-11"
            aria-pressed={props.tool === id}
            aria-label={label}
            title={label}
            disabled={busy}
            onClick={() => props.onToolChange(id)}
          >
            <Icon aria-hidden="true" />
            <span className="hidden md:inline">{label}</span>
          </Button>
        ))}
      </div>
      <div
        role="toolbar"
        aria-label="Insert and history"
        className="flex items-center gap-1"
      >
        <Button
          variant="ghost"
          className="min-h-11 min-w-11"
          aria-label="Add image"
          title="Add image"
          disabled={busy}
          onClick={() => imageInput.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          <span className="hidden md:inline">Image</span>
        </Button>
        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="image-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // allow picking the same image again
            if (file) props.onPickImage(file);
          }}
        />
        <span className="bg-border mx-1 h-6 w-px" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={busy || !props.canUndo}
          onClick={props.onUndo}
        >
          <Undo2 aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={busy || !props.canRedo}
          onClick={props.onRedo}
        >
          <Redo2 aria-hidden="true" />
        </Button>
      </div>
      <div className="ml-auto flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Open another PDF"
          title="Open another PDF"
          onClick={props.onClose}
        >
          <FolderOpen aria-hidden="true" />
        </Button>
        <Button
          className="min-h-11"
          disabled={busy}
          // Explicit name: the visible label is shortened on phones.
          aria-label={busy ? "Saving…" : "Download PDF"}
          onClick={props.onDownload}
        >
          <Download aria-hidden="true" />
          {busy ? (
            "Saving…"
          ) : (
            <>
              Download<span className="hidden sm:inline">{" PDF"}</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
