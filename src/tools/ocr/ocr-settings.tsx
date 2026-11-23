"use client";

/**
 * OCR configuration form: multi-language selector (English + 10 Indian languages),
 * rasterization DPI selector, "Redo OCR on pages that already have text", and
 * low-contrast scan enhancement toggle.
 *
 * Follows Single Responsibility Principle (SRP) by isolating option editing UI
 * and validation display from worker execution.
 */

import { useId } from "react";
import { cn } from "@/lib/utils";
import {
  formatLanguageNames,
  normalizeLanguageSelection,
  OCR_LANGUAGES,
} from "./core/languages";
import type { OcrDpi, OcrLanguageCode, OcrOptions } from "./core/model";
import { SUPPORTED_OCR_DPIS } from "./core/options";

export interface OcrSettingsFormProps {
  options: OcrOptions;
  onChange(options: OcrOptions): void;
  validationError: string | null;
  disabled?: boolean;
}

const DPI_LABELS: Record<OcrDpi, string> = {
  150: "150 DPI (Fast)",
  200: "200 DPI (Balanced)",
  300: "300 DPI (Recommended)",
};

/**
 * Form controls for picking OCR languages, resolution, and scan preprocessing options.
 *
 * @param props Current options, change callback, validation error, and disabled flag.
 * @returns Accessible fieldset of OCR settings.
 */
export function OcrSettingsForm({
  options,
  onChange,
  validationError,
  disabled,
}: OcrSettingsFormProps) {
  const id = useId();
  const patch = (next: Partial<OcrOptions>) =>
    onChange({ ...options, ...next });

  const toggleLanguage = (code: OcrLanguageCode) => {
    const exists = options.languages.includes(code);
    const next = exists
      ? options.languages.filter((l) => l !== code)
      : normalizeLanguageSelection([...options.languages, code]);
    patch({ languages: next });
  };

  return (
    <fieldset
      disabled={disabled}
      className="space-y-4 rounded-xl border bg-card p-4 disabled:opacity-60"
    >
      <legend className="px-1 text-sm font-semibold">OCR settings</legend>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">
            Document languages ({formatLanguageNames(options.languages)})
          </span>
          <span className="text-muted-foreground text-xs">
            Pick all languages appearing on the page (e.g. English + Hindi)
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {OCR_LANGUAGES.map((lang) => {
            const selected = options.languages.includes(lang.code);
            return (
              <label
                key={lang.code}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleLanguage(lang.code)}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 truncate">
                  <span className="font-medium">{lang.name}</span>
                  {lang.nativeName !== lang.name && (
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {lang.nativeName}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-dpi`} className="text-sm font-medium">
            Recognition resolution
          </label>
          <select
            id={`${id}-dpi`}
            value={options.dpi}
            onChange={(e) =>
              patch({ dpi: Number(e.target.value) as OcrDpi })
            }
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3"
          >
            {SUPPORTED_OCR_DPIS.map((dpi) => (
              <option key={dpi} value={dpi}>
                {DPI_LABELS[dpi]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col justify-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.redoExistingText}
              onChange={(e) => patch({ redoExistingText: e.target.checked })}
              className="size-4 accent-primary"
            />
            Redo OCR on pages that already have text
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.enhanceScan}
              onChange={(e) => patch({ enhanceScan: e.target.checked })}
              className="size-4 accent-primary"
            />
            Enhance faded or low-contrast scans
          </label>
        </div>
      </div>

      {validationError && (
        <p role="alert" className="text-destructive text-sm font-medium">
          {validationError}
        </p>
      )}
    </fieldset>
  );
}
