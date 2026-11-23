"use client";

import { ImageUp } from "lucide-react";
import { useId, useRef } from "react";
import {
  ColorField,
  NumberField,
  RangeField,
  fieldClass,
} from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { IMAGE_ACCEPT } from "@/lib/image-info";
import { cn } from "@/lib/utils";
import type { WatermarkForm } from "./core/form";
import {
  FONT_SIZE_LIMITS,
  IMAGE_SCALE_LIMITS,
  WATERMARK_FONTS,
  type WatermarkFont,
} from "./core/model";

/** Font choices, labelled with the PDF font each one uses. */
export const FONT_LABELS: Record<WatermarkFont, string> = {
  helvetica: "Sans serif (Helvetica)",
  times: "Serif (Times)",
  courier: "Monospace (Courier)",
};

/** Percentage text for a 0..1 fraction, e.g. 0.4 -> "40%". */
export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

interface TextSettingsProps {
  text: WatermarkForm["text"];
  onChange(text: WatermarkForm["text"]): void;
  /** Why the text cannot be used, shown under the field. */
  error: string | null;
}

/**
 * The text watermark: the text itself, font, bold, size and colour.
 *
 * The text area is marked invalid and points at the error message when the
 * text cannot be used (empty, or characters the standard fonts lack), so
 * the problem is announced where it is typed.
 *
 * @param props The text settings, a change handler and an error.
 * @returns The fields.
 */
export function TextSettings({ text, onChange, error }: TextSettingsProps) {
  const textId = useId();
  const errorId = useId();
  const fontId = useId();
  const set = (patch: Partial<WatermarkForm["text"]>) =>
    onChange({ ...text, ...patch });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={textId} className="text-sm font-medium">
          Watermark text
        </label>
        <textarea
          id={textId}
          rows={2}
          value={text.text}
          onChange={(e) => set({ text: e.target.value })}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className={cn(fieldClass, "h-auto min-h-20 py-2")}
        />
        {error && (
          <p id={errorId} className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={fontId} className="text-sm font-medium">
            Font
          </label>
          <select
            id={fontId}
            value={text.font}
            onChange={(e) => set({ font: e.target.value as WatermarkFont })}
            className={fieldClass}
          >
            {WATERMARK_FONTS.map((font) => (
              <option key={font} value={font}>
                {FONT_LABELS[font]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={text.bold}
            onChange={(e) => set({ bold: e.target.checked })}
            className="accent-primary size-5"
          />
          Bold
        </label>
        <NumberField
          label="Size (pt)"
          value={text.fontSize}
          limits={FONT_SIZE_LIMITS}
          onChange={(fontSize) => set({ fontSize })}
        />
        <ColorField
          label="Colour"
          value={text.color}
          onChange={(color) => set({ color })}
        />
      </div>
    </div>
  );
}

interface ImageSettingsProps {
  /** The picked picture's file name, if any. */
  imageName: string | null;
  scale: number;
  onPick(file: File): void;
  onScaleChange(scale: number): void;
  /** Shown when no picture is picked yet. */
  error: string | null;
}

/**
 * The picture watermark: choose a PNG or JPEG, and its width relative to
 * the page.
 *
 * @param props The picked file's name, the scale and handlers.
 * @returns The fields.
 */
export function ImageSettings({
  imageName,
  scale,
  onPick,
  onScaleChange,
  error,
}: ImageSettingsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = ""; // allow picking the same file again
          }}
        />
        <Button
          variant="outline"
          className="min-h-11"
          aria-describedby={statusId}
          onClick={() => inputRef.current?.click()}
        >
          <ImageUp aria-hidden="true" />
          {imageName ? "Choose another picture" : "Choose a picture"}
        </Button>
        <p
          id={statusId}
          className={cn(
            "min-w-0 text-sm [overflow-wrap:anywhere]",
            imageName ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {imageName ?? error ?? ""}
        </p>
      </div>
      <RangeField
        label="Width (of the page width)"
        value={scale}
        min={IMAGE_SCALE_LIMITS.min}
        max={IMAGE_SCALE_LIMITS.max}
        step={0.05}
        format={percent}
        onChange={onScaleChange}
      />
    </div>
  );
}
