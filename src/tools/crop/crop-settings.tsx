"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { mmToPoints, pointsToMm, type Margins } from "./core/margins";
import type { CropSettings } from "./core/settings";

interface CropSettingsFormProps {
  settings: CropSettings;
  onChange(settings: CropSettings): void;
  /** Why the page range is not usable, shown under it. */
  rangeError: string | null;
  disabled?: boolean;
}

const fieldClass =
  "h-11 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

const EDGES: readonly { key: keyof Margins; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "right", label: "Right" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
];

/**
 * A margin in millimetres for an input, to 2 decimals (more would flicker
 * as the points round-trip while typing).
 *
 * @param points The margin in points.
 * @returns The value to show, or "" while the field is empty (NaN).
 */
export function marginFieldValue(points: number): number | "" {
  return Number.isFinite(points) ? Number(pointsToMm(points).toFixed(2)) : "";
}

/**
 * The crop settings: a margin for each displayed edge (in millimetres;
 * they are the keyboard way to set the area dragged on the page), which
 * pages to crop, and whether to remove what lies outside.
 *
 * An emptied margin field reports `NaN` and is passed on as it is, so
 * clearing a field to type a new number does not snap back under the
 * cursor; the plan refuses it until a number is typed.
 *
 * @param props The settings and a change handler.
 * @returns The form controls.
 */
export function CropSettingsForm({
  settings,
  onChange,
  rangeError,
  disabled,
}: CropSettingsFormProps) {
  const id = useId();
  const set = (patch: Partial<CropSettings>) =>
    onChange({ ...settings, ...patch });
  return (
    <fieldset disabled={disabled} className="space-y-5 disabled:opacity-60">
      <legend className="sr-only">Crop settings</legend>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          Cut from each edge (mm)
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {EDGES.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${key}`} className="text-sm">
                {label}
              </label>
              <input
                id={`${id}-${key}`}
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                className={fieldClass}
                value={marginFieldValue(settings.margins[key])}
                onChange={(e) =>
                  set({
                    margins: {
                      ...settings.margins,
                      [key]: mmToPoints(e.target.valueAsNumber),
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Pages</legend>
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-pages`}
              className="size-4"
              checked={settings.pages === "all"}
              onChange={() => set({ pages: "all" })}
            />
            All pages
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-pages`}
              className="size-4"
              checked={settings.pages === "range"}
              onChange={() => set({ pages: "range" })}
            />
            Only these pages
          </label>
          <input
            type="text"
            aria-label="Pages to crop, for example 1-3, 5"
            placeholder="e.g. 1-3, 5"
            className={cn(fieldClass, "w-full")}
            disabled={disabled || settings.pages !== "range"}
            value={settings.range}
            aria-invalid={rangeError !== null}
            aria-describedby={rangeError ? `${id}-range-error` : undefined}
            onChange={(e) => set({ range: e.target.value })}
          />
          {rangeError && (
            <p id={`${id}-range-error`} className="text-destructive text-sm">
              {rangeError}
            </p>
          )}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.removeOutside}
            aria-describedby={`${id}-remove-help`}
            onChange={(e) => set({ removeOutside: e.target.checked })}
          />
          Remove what&apos;s outside
        </label>
        <p id={`${id}-remove-help`} className="text-muted-foreground text-sm">
          {settings.removeOutside
            ? "Deletes the text, pictures and drawings outside the crop area from the file, then checks that everything inside is unchanged."
            : "The content outside is only hidden: it stays in the file and anyone can bring it back."}
        </p>
      </div>
    </fieldset>
  );
}
