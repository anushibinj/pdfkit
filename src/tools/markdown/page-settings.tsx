"use client";

import { useId } from "react";
import {
  MARGIN_LIMITS_MM,
  PAGE_SIZES,
  isPageSizeName,
} from "./core/page-setup";
import type { PageSetup } from "./messages";

interface PageSettingsProps {
  value: PageSetup;
  onChange: (value: PageSetup) => void;
  /** Blocks changes, e.g. while a conversion runs */
  disabled?: boolean;
}

const fieldClass =
  "h-11 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * Paper size and margin controls.
 *
 * The margin field reports `NaN` while it is empty (mid-edit). It is passed
 * on as-is and normalised to the default only at conversion time, so clearing
 * the field to type a new number does not snap it back under the cursor.
 *
 * @param props The current setup and a change handler.
 * @returns A fieldset with the two controls.
 */
export function PageSettings({ value, onChange, disabled }: PageSettingsProps) {
  const sizeId = useId();
  const marginId = useId();
  return (
    <fieldset
      disabled={disabled}
      className="flex flex-wrap items-end gap-4 disabled:opacity-60"
    >
      <legend className="sr-only">Page settings</legend>
      <div className="flex flex-col gap-1">
        <label htmlFor={sizeId} className="text-sm font-medium">
          Paper size
        </label>
        <select
          id={sizeId}
          className={fieldClass}
          value={value.size}
          onChange={(e) => {
            if (isPageSizeName(e.target.value))
              onChange({ ...value, size: e.target.value });
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={marginId} className="text-sm font-medium">
          Margin (mm)
        </label>
        <input
          id={marginId}
          type="number"
          inputMode="decimal"
          min={MARGIN_LIMITS_MM.min}
          max={MARGIN_LIMITS_MM.max}
          step={1}
          className={`${fieldClass} w-28`}
          value={Number.isFinite(value.marginMm) ? value.marginMm : ""}
          onChange={(e) =>
            onChange({ ...value, marginMm: e.target.valueAsNumber })
          }
        />
      </div>
    </fieldset>
  );
}
