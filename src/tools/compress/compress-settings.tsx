"use client";

/**
 * Compression preset selector and custom/target-size parameter controls.
 *
 * Follows Single Responsibility Principle (SRP) by keeping form input layout,
 * preset descriptions, and validation feedback isolated from worker execution.
 */

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { CompressOptions, CompressPreset } from "./core/model";
import {
  MAX_DPI,
  MAX_TARGET_MB,
  MIN_DPI,
  MIN_TARGET_MB,
} from "./core/options";

export interface CompressSettingsFormProps {
  options: CompressOptions;
  onChange(options: CompressOptions): void;
  validationError: string | null;
  disabled?: boolean;
}

const PRESET_CARDS: readonly {
  id: CompressPreset;
  label: string;
  summary: string;
}[] = [
  {
    id: "lossless",
    label: "Lossless",
    summary: "Structure & stream optimization only. Zero visual change.",
  },
  {
    id: "balanced",
    label: "Balanced",
    summary: "Images up to 150 DPI at 75% quality. Recommended for most PDFs.",
  },
  {
    id: "small",
    label: "Small",
    summary: "Images up to 100 DPI at 60% quality for compact sharing.",
  },
  {
    id: "target-size",
    label: "Target size",
    summary: "Fit under a specific MB limit for upload portals.",
  },
  {
    id: "custom",
    label: "Custom",
    summary: "Pick exact DPI, JPEG quality, and grayscale conversion.",
  },
];

const inputClass =
  "h-10 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Form controls for selecting compression preset (`lossless`, `balanced`,
 * `small`, `target-size`, `custom`) and tuning mode-specific fields.
 *
 * @param props Current options, change handler, validation error, and disabled flag.
 * @returns Accessible fieldset of compression controls.
 */
export function CompressSettingsForm({
  options,
  onChange,
  validationError,
  disabled,
}: CompressSettingsFormProps) {
  const id = useId();
  const patch = (next: Partial<CompressOptions>) =>
    onChange({ ...options, ...next });

  return (
    <fieldset
      disabled={disabled}
      className="space-y-4 rounded-xl border bg-card p-4 disabled:opacity-60"
    >
      <legend className="px-1 text-sm font-semibold">Compression mode</legend>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PRESET_CARDS.map((card) => {
          const selected = options.preset === card.id;
          return (
            <label
              key={card.id}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name={`${id}-preset`}
                  value={card.id}
                  checked={selected}
                  onChange={() => patch({ preset: card.id })}
                  className="size-4 accent-primary"
                />
                {card.label}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">
                {card.summary}
              </span>
            </label>
          );
        })}
      </div>

      {options.preset === "target-size" && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor={`${id}-target-mb`}
              className="text-sm font-medium"
            >
              Make it under (MB)
            </label>
            <input
              id={`${id}-target-mb`}
              type="number"
              inputMode="decimal"
              min={MIN_TARGET_MB}
              max={MAX_TARGET_MB}
              step={0.1}
              value={Number.isFinite(options.targetSizeMb) ? options.targetSizeMb : ""}
              onChange={(e) => patch({ targetSizeMb: e.target.valueAsNumber })}
              className={cn(inputClass, "w-28")}
            />
            <span className="text-muted-foreground text-xs">
              Steps safely down to 72 DPI / 40% quality; warns if unreachable without ruining legibility.
            </span>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.grayscale}
              onChange={(e) => patch({ grayscale: e.target.checked })}
              className="size-4 accent-primary"
            />
            Allow grayscale conversion if needed
          </label>
        </div>
      )}

      {options.preset === "custom" && (
        <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-dpi`} className="text-sm font-medium">
              Max image DPI
            </label>
            <input
              id={`${id}-dpi`}
              type="number"
              min={MIN_DPI}
              max={MAX_DPI}
              step={1}
              value={Number.isFinite(options.dpi) ? options.dpi : ""}
              onChange={(e) => patch({ dpi: e.target.valueAsNumber })}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-quality`} className="text-sm font-medium">
              JPEG quality ({Math.round((options.quality || 0) * 100)}%)
            </label>
            <input
              id={`${id}-quality`}
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round((options.quality || 0.75) * 100)}
              onChange={(e) =>
                patch({ quality: Number(e.target.value) / 100 })
              }
              className="mt-2 h-6 w-full accent-primary"
            />
          </div>

          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={options.grayscale}
                onChange={(e) => patch({ grayscale: e.target.checked })}
                className="size-4 accent-primary"
              />
              Convert images to grayscale
            </label>
          </div>
        </div>
      )}

      {validationError && (
        <p role="alert" className="text-destructive text-sm font-medium">
          {validationError}
        </p>
      )}
    </fieldset>
  );
}
