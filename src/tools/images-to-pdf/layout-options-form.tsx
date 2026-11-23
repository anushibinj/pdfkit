"use client";

import { useId } from "react";
import {
  IMAGE_MARGIN_LIMITS_MM,
  IMAGE_PAGE_SIZES,
  IMAGE_SCALE_MODES,
  PAGE_ORIENTATIONS,
  isImagePageSize,
  isImageScaleMode,
  isPageOrientation,
  type ImagePageSize,
  type ImageScaleMode,
  type PageLayoutOptions,
  type PageOrientation,
} from "./core/options";

interface LayoutOptionsFormProps {
  value: PageLayoutOptions;
  onChange: (next: PageLayoutOptions) => void;
  /** Disables all controls while a PDF build is running. */
  disabled?: boolean;
}

const fieldClass =
  "h-11 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const PAGE_SIZE_LABELS: Record<ImagePageSize, string> = {
  fit: "Fit to image",
  A4: "A4",
  Letter: "Letter",
  Legal: "Legal",
};

const ORIENTATION_LABELS: Record<PageOrientation, string> = {
  auto: "Auto (match image)",
  portrait: "Portrait",
  landscape: "Landscape",
};

const SCALE_MODE_LABELS: Record<ImageScaleMode, string> = {
  contain: "Fit inside margins",
  actual: "Actual size (72 DPI)",
};

/**
 * Page layout settings form for Images to PDF: paper size, orientation,
 * margin (mm), and image scaling mode.
 *
 * Orientation and scaling mode apply only to fixed paper sizes (A4, Letter,
 * Legal) and are hidden when "Fit to image" is selected. Margin reports `NaN`
 * while cleared mid-edit and is normalised cleanly at build time.
 *
 * @param props Current layout options, change callback, and disabled flag.
 * @returns Accessible fieldset containing the layout controls.
 */
export function LayoutOptionsForm({
  value,
  onChange,
  disabled,
}: LayoutOptionsFormProps) {
  const sizeId = useId();
  const orientationId = useId();
  const marginId = useId();
  const scaleId = useId();
  const isFixedPaper = value.pageSize !== "fit";

  return (
    <fieldset
      disabled={disabled}
      className="flex flex-wrap items-end gap-4 rounded-xl border p-4 disabled:opacity-60"
    >
      <legend className="px-1 text-sm font-medium">Page settings</legend>

      <div className="flex flex-col gap-1">
        <label htmlFor={sizeId} className="text-sm font-medium">
          Paper size
        </label>
        <select
          id={sizeId}
          className={fieldClass}
          value={value.pageSize}
          onChange={(e) => {
            if (isImagePageSize(e.target.value)) {
              onChange({ ...value, pageSize: e.target.value });
            }
          }}
        >
          {IMAGE_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {PAGE_SIZE_LABELS[size]}
            </option>
          ))}
        </select>
      </div>

      {isFixedPaper && (
        <div className="flex flex-col gap-1">
          <label htmlFor={orientationId} className="text-sm font-medium">
            Orientation
          </label>
          <select
            id={orientationId}
            className={fieldClass}
            value={value.orientation}
            onChange={(e) => {
              if (isPageOrientation(e.target.value)) {
                onChange({ ...value, orientation: e.target.value });
              }
            }}
          >
            {PAGE_ORIENTATIONS.map((orientation) => (
              <option key={orientation} value={orientation}>
                {ORIENTATION_LABELS[orientation]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={marginId} className="text-sm font-medium">
          Margin (mm)
        </label>
        <input
          id={marginId}
          type="number"
          inputMode="decimal"
          min={IMAGE_MARGIN_LIMITS_MM.min}
          max={IMAGE_MARGIN_LIMITS_MM.max}
          step={1}
          className={`${fieldClass} w-28`}
          value={Number.isFinite(value.marginMm) ? value.marginMm : ""}
          onChange={(e) =>
            onChange({ ...value, marginMm: e.target.valueAsNumber })
          }
        />
      </div>

      {isFixedPaper && (
        <div className="flex flex-col gap-1">
          <label htmlFor={scaleId} className="text-sm font-medium">
            Image scaling
          </label>
          <select
            id={scaleId}
            className={fieldClass}
            value={value.scaleMode}
            onChange={(e) => {
              if (isImageScaleMode(e.target.value)) {
                onChange({ ...value, scaleMode: e.target.value });
              }
            }}
          >
            {IMAGE_SCALE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SCALE_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
      )}
    </fieldset>
  );
}
