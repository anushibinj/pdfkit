"use client";

import { useId, useState } from "react";
import { hexToRgb, rgbToHex, type Rgb } from "@/lib/color";

/** Look of single-line form controls (inputs and selects), 44 px tall. */
export const fieldClass =
  "h-11 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * Force a number into a range.
 *
 * @param n The number.
 * @param limits Inclusive range.
 * @returns The clamped number.
 */
function clamp(n: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, n));
}

interface NumberFieldProps {
  label: string;
  value: number;
  limits: { min: number; max: number };
  step?: number;
  onChange(value: number): void;
}

/**
 * A labelled number input that tolerates being cleared while typing.
 *
 * The text the user types is kept as a draft, so emptying the field to type
 * a new value does not snap the old number back under the cursor. Every
 * valid number is clamped and reported at once; the draft is dropped on
 * blur, showing the value actually in use.
 *
 * @param props Label, value, range and change handler.
 * @returns The field.
 */
export function NumberField({
  label,
  value,
  limits,
  step = 1,
  onChange,
}: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={limits.min}
        max={limits.max}
        step={step}
        className={`${fieldClass} w-24`}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n))
            onChange(clamp(n, limits));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

/**
 * A labelled colour picker.
 *
 * @param props Label, colour and change handler.
 * @returns The field.
 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Rgb;
  onChange(value: Rgb): void;
}) {
  const id = useId();
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="color"
        className="border-input h-11 w-16 cursor-pointer rounded-lg border bg-transparent p-1"
        value={rgbToHex(value)}
        onChange={(e) => {
          const rgb = hexToRgb(e.target.value);
          if (rgb) onChange(rgb);
        }}
      />
    </div>
  );
}

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shows the value next to the label, e.g. 0.3 -> "30%". */
  format(value: number): string;
  onChange(value: number): void;
}

/**
 * A labelled slider that shows its current value.
 *
 * The value is also given to assistive technology through
 * `aria-valuetext`, so a screen reader says "30%" rather than "0.3".
 *
 * @param props Label, range, formatter and change handler.
 * @returns The field.
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: RangeFieldProps) {
  const id = useId();
  const text = format(value);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output
          htmlFor={id}
          className="text-muted-foreground text-sm tabular-nums"
        >
          {text}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        className="accent-primary h-11 w-full cursor-pointer"
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </div>
  );
}
