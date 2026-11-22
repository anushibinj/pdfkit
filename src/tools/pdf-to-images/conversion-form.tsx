"use client";

import { FileImage, Images, Square } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_RENDER_OPTIONS,
  DPI_PRESETS,
  type PageImageFormat,
  type PageRenderOptions,
} from "./core/options";
import { parsePageRanges } from "./core/page-ranges";
import type { ConversionMode } from "./core/run-state";

/** Everything the user chooses before converting. */
export interface ConversionSettings {
  mode: ConversionMode;
  render: PageRenderOptions;
  /** The "Pages" field as typed (empty: every page). */
  pages: string;
}

export const DEFAULT_SETTINGS: ConversionSettings = {
  mode: "pages",
  render: DEFAULT_RENDER_OPTIONS,
  pages: "",
};

/** Labels for the resolution presets. */
const DPI_LABELS: Record<(typeof DPI_PRESETS)[number], string> = {
  72: "72 DPI (screen)",
  150: "150 DPI (standard)",
  300: "300 DPI (print)",
  600: "600 DPI (high)",
};

/** JPEG qualities offered. */
export const QUALITY_PRESETS = [1, 0.9, 0.8, 0.7, 0.6] as const;

const MODES: {
  mode: ConversionMode;
  title: string;
  detail: string;
  icon: typeof FileImage;
}[] = [
  {
    mode: "pages",
    title: "Pages as images",
    detail: "Each page becomes a PNG or JPEG file.",
    icon: FileImage,
  },
  {
    mode: "images",
    title: "Embedded images",
    detail: "The pictures inside the PDF, at their own size.",
    icon: Images,
  },
];

const fieldClass =
  "h-11 rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

interface ConversionFormProps {
  pageCount: number;
  settings: ConversionSettings;
  onChange(settings: ConversionSettings): void;
  /** A run is going: the fields lock and Convert becomes Stop. */
  running: boolean;
  /** Stop was pressed; the current page is finishing. */
  stopping: boolean;
  /** Convert the given zero-based pages. */
  onConvert(pages: number[]): void;
  onStop(): void;
}

/**
 * The choices for a conversion and the button that starts (or stops) it.
 *
 * The "Pages" field is parsed on every change (`parsePageRanges`); while it
 * is invalid the reason is shown under it and Convert is disabled, so a run
 * only ever starts with a valid selection.
 *
 * @param props Current settings, run status and callbacks.
 * @returns A form.
 */
export function ConversionForm({
  pageCount,
  settings,
  onChange,
  running,
  stopping,
  onConvert,
  onStop,
}: ConversionFormProps) {
  const ids = {
    format: useId(),
    dpi: useId(),
    quality: useId(),
    pages: useId(),
    pagesHint: useId(),
  };
  const selection = parsePageRanges(settings.pages, pageCount);
  const { render } = settings;
  const setRender = (patch: Partial<PageRenderOptions>) =>
    onChange({ ...settings, render: { ...render, ...patch } });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!running && selection.ok) onConvert(selection.pages);
      }}
    >
      <fieldset disabled={running} className="space-y-5 disabled:opacity-60">
        <div
          role="radiogroup"
          aria-label="What to export"
          className="grid gap-3 sm:grid-cols-2"
        >
          {MODES.map(({ mode, title, detail, icon: Icon }) => (
            <label
              key={mode}
              className={cn(
                "has-[:focus-visible]:ring-ring/50 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-3",
                settings.mode === mode
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name="export-mode"
                value={mode}
                checked={settings.mode === mode}
                onChange={() => onChange({ ...settings, mode })}
                className="sr-only"
              />
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span className="space-y-1">
                <span className="block font-medium">{title}</span>
                <span className="text-muted-foreground block text-sm">
                  {detail}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-4">
          {settings.mode === "pages" && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.format} className="text-sm font-medium">
                  Format
                </label>
                <select
                  id={ids.format}
                  className={fieldClass}
                  value={render.format}
                  onChange={(e) =>
                    setRender({ format: e.target.value as PageImageFormat })
                  }
                >
                  <option value="png">PNG (lossless)</option>
                  <option value="jpeg">JPEG (smaller)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.dpi} className="text-sm font-medium">
                  Resolution
                </label>
                <select
                  id={ids.dpi}
                  className={fieldClass}
                  value={render.dpi}
                  onChange={(e) => setRender({ dpi: Number(e.target.value) })}
                >
                  {DPI_PRESETS.map((dpi) => (
                    <option key={dpi} value={dpi}>
                      {DPI_LABELS[dpi]}
                    </option>
                  ))}
                </select>
              </div>
              {render.format === "jpeg" && (
                <div className="flex flex-col gap-1">
                  <label htmlFor={ids.quality} className="text-sm font-medium">
                    Quality
                  </label>
                  <select
                    id={ids.quality}
                    className={fieldClass}
                    value={render.quality}
                    onChange={(e) =>
                      setRender({ quality: Number(e.target.value) })
                    }
                  >
                    {QUALITY_PRESETS.map((quality) => (
                      <option key={quality} value={quality}>
                        {Math.round(quality * 100)}%
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
            <label htmlFor={ids.pages} className="text-sm font-medium">
              Pages
            </label>
            <input
              id={ids.pages}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder={`All ${pageCount} ${pageCount === 1 ? "page" : "pages"}`}
              className={cn(fieldClass, "w-full")}
              value={settings.pages}
              onChange={(e) => onChange({ ...settings, pages: e.target.value })}
              aria-invalid={!selection.ok}
              aria-describedby={ids.pagesHint}
            />
            <p
              id={ids.pagesHint}
              className={cn(
                "text-sm",
                selection.ok ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {selection.ok ? "For example 1-3, 5, 8-" : selection.error}
            </p>
          </div>
        </div>
      </fieldset>

      {running ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full px-6 text-base sm:w-auto"
          onClick={onStop}
          disabled={stopping}
        >
          <Square aria-hidden="true" /> {stopping ? "Stopping…" : "Stop"}
        </Button>
      ) : (
        <Button
          type="submit"
          className="min-h-11 w-full px-6 text-base sm:w-auto"
          disabled={!selection.ok}
        >
          {settings.mode === "pages" ? "Convert pages" : "Extract images"}
        </Button>
      )}
    </form>
  );
}
