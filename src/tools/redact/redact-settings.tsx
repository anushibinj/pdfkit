"use client";

import { Input } from "@/components/ui/input";
import type { CleanupOptions, RedactionMarkStyle } from "./core/model";

export interface RedactSettingsProps {
  style: RedactionMarkStyle;
  cleanup: CleanupOptions;
  rasterizePages: boolean;
  disabled?: boolean;
  onStyleChange(style: RedactionMarkStyle): void;
  onCleanupChange(cleanup: CleanupOptions): void;
  onRasterizeChange(rasterize: boolean): void;
}

/**
 * Mark style (black/white fill + optional overlay label), document-wide
 * sanitization toggles, and maximum-certainty rasterisation fallback.
 *
 * @param props Current style, cleanup, and rasterisation settings.
 * @returns Settings form section.
 */
export function RedactSettings({
  style,
  cleanup,
  rasterizePages,
  disabled,
  onStyleChange,
  onCleanupChange,
  onRasterizeChange,
}: RedactSettingsProps) {
  const toggleCleanup = (key: keyof CleanupOptions, checked: boolean) => {
    onCleanupChange({ ...cleanup, [key]: checked });
  };

  return (
    <section
      aria-label="Redaction settings"
      className="space-y-4 rounded-lg border p-4"
    >
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Mark style</h2>
        <div className="grid grid-cols-2 gap-2">
          {(["black", "white"] as const).map((fill) => (
            <button
              key={fill}
              type="button"
              disabled={disabled}
              aria-pressed={style.fill === fill}
              onClick={() => onStyleChange({ ...style, fill })}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                style.fill === fill
                  ? "border-primary bg-primary/5 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-3 rounded-xs border ${
                  fill === "black" ? "bg-black" : "bg-white"
                }`}
              />
              {fill === "black" ? "Black fill" : "White fill"}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <label htmlFor="redact-mark-label" className="block text-xs font-medium">
            Overlay label (optional)
          </label>
          <Input
            id="redact-mark-label"
            value={style.label}
            disabled={disabled}
            maxLength={48}
            placeholder="e.g. REDACTED"
            onChange={(e) =>
              onStyleChange({ ...style, label: e.target.value })
            }
          />
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <h2 className="text-sm font-semibold">Document-wide clean-up</h2>
        <div className="space-y-2">
          {(
            [
              [
                "metadata",
                "Metadata & XMP",
                "Strip Info dictionary, XMP streams, thumbnails, and matching structure text",
              ],
              [
                "attachments",
                "Attachments",
                "Remove embedded files and file attachment annotations",
              ],
              [
                "javascript",
                "JavaScript",
                "Remove embedded JavaScript names and document/page actions",
              ],
              [
                "hiddenLayers",
                "Hidden layers",
                "Strip Optional Content Groups (OCGs) so hidden layers cannot persist",
              ],
              [
                "bookmarks",
                "Bookmark titles",
                "Scrub bookmark titles that contain any redacted term",
              ],
            ] as const
          ).map(([key, title, hint]) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-2 text-xs"
            >
              <input
                type="checkbox"
                checked={cleanup[key]}
                disabled={disabled}
                onChange={(e) => toggleCleanup(key, e.target.checked)}
                className="accent-primary mt-0.5 size-4 shrink-0 rounded border"
              />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={rasterizePages}
            disabled={disabled}
            onChange={(e) => onRasterizeChange(e.target.checked)}
            className="accent-primary mt-0.5 size-4 shrink-0 rounded border"
          />
          <span>
            <span className="block font-semibold">
              Rasterise redacted pages (maximum certainty)
            </span>
            <span className="text-muted-foreground">
              Flattens pages that have redactions into flat images so no vector
              paths, fonts, or Form XObjects survive.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
