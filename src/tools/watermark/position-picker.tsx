"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { ANCHORS, type Anchor, type Position } from "./core/model";

/** Accessible names of the nine anchors. */
export const ANCHOR_LABELS: Record<Anchor, string> = {
  "top-left": "Top left",
  top: "Top centre",
  "top-right": "Top right",
  left: "Middle left",
  center: "Centre",
  right: "Middle right",
  "bottom-left": "Bottom left",
  bottom: "Bottom centre",
  "bottom-right": "Bottom right",
};

/** Style of one choice; the radio inside is visually hidden. */
const choiceClass =
  "flex cursor-pointer items-center justify-center rounded-md border border-transparent transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";

interface PositionPickerProps {
  value: Position;
  onChange(value: Position): void;
}

/**
 * Where the watermark goes: one of nine places on the page (a 3 x 3 grid
 * that looks like the page), or tiled across it.
 *
 * All ten choices are one native radio group, so arrow keys move between
 * them and screen readers announce "Top left, radio button, 1 of 10". The
 * radios are visually hidden; their label is the visible target (44 px).
 *
 * @param props The current position and a change handler.
 * @returns A fieldset.
 */
export function PositionPicker({ value, onChange }: PositionPickerProps) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Position</legend>
      <div className="flex flex-wrap items-center gap-4">
        <div className="bg-muted/30 grid w-fit grid-cols-3 gap-1 rounded-lg border p-1">
          {ANCHORS.map((anchor) => (
            <label key={anchor} className={cn(choiceClass, "size-11")}>
              <input
                type="radio"
                name={name}
                value={anchor}
                checked={value === anchor}
                onChange={() => onChange(anchor)}
                aria-label={ANCHOR_LABELS[anchor]}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-current"
              />
            </label>
          ))}
        </div>
        <label
          className={cn(
            choiceClass,
            "border-border min-h-11 gap-2 px-4 text-sm",
          )}
        >
          <input
            type="radio"
            name={name}
            value="tile"
            checked={value === "tile"}
            onChange={() => onChange("tile")}
            className="sr-only"
          />
          Tile across the page
        </label>
      </div>
    </fieldset>
  );
}
