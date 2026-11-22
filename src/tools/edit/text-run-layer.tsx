"use client";

import { toSvgTransform, type Matrix } from "@/lib/geometry/affine";
import { runHitArea } from "./core/inline-editing";
import type { TextRun } from "./core/text-runs";
import { cn } from "@/lib/utils";

interface TextRunLayerProps {
  runs: readonly TextRun[];
  /** Current text of edited lines, by line id. */
  edits: Readonly<Record<string, string>>;
  /** The line being edited (its target is hidden; the field replaces it). */
  editingRunId: string | null;
  /** Line-to-view transform of a line (see `runToView`). */
  toView(run: TextRun): Matrix;
  /** Start editing a line. */
  onStart(runId: string): void;
}

/**
 * Click targets over every line of the page's own text (Edit text tool).
 *
 * Each target is a transparent rectangle over the line's glyphs, turned
 * with the line. Hovering or focusing outlines it so the user sees which
 * line a click would edit. Targets are buttons in the tab order, so the
 * keyboard can reach every line (Enter or Space starts editing). Lines
 * already changed are outlined faintly, so edits are easy to find again.
 *
 * @param props The lines and callbacks.
 * @returns An SVG group.
 */
export function TextRunLayer({
  runs,
  edits,
  editingRunId,
  toView,
  onStart,
}: TextRunLayerProps) {
  return (
    <g data-text-runs="">
      {runs.map((run) => {
        if (run.id === editingRunId) return null;
        const area = runHitArea(run);
        const current = edits[run.id] ?? run.text;
        const edited = run.id in edits;
        return (
          <rect
            key={run.id}
            transform={toSvgTransform(toView(run))}
            x={area.x}
            y={area.y}
            width={Math.max(area.width, 1)}
            height={area.height}
            fill="transparent"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            role="button"
            tabIndex={0}
            aria-label={
              current.trim() === ""
                ? "Edit text (deleted line)"
                : `Edit text: ${current.trim()}`
            }
            data-run-id={run.id}
            className={cn(
              "cursor-text outline-none hover:stroke-blue-600 focus-visible:stroke-blue-600",
              edited ? "stroke-blue-600/40" : "stroke-transparent",
            )}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onStart(run.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onStart(run.id);
              }
            }}
          />
        );
      })}
    </g>
  );
}
