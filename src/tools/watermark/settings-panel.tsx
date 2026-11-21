"use client";

import { useId } from "react";
import { RangeField, fieldClass } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImageSettings, TextSettings, percent } from "./content-settings";
import type { FormCheck, WatermarkForm } from "./core/form";
import { OPACITY_LIMITS, ROTATION_LIMITS, type Layer } from "./core/model";
import { PositionPicker } from "./position-picker";

/** Quick choices for the angle, in degrees. */
export const ROTATION_PRESETS = [0, 45, 90, -45] as const;

/** The two layers, with what each means for the reader. */
const LAYERS: readonly { value: Layer; label: string; hint: string }[] = [
  {
    value: "over",
    label: "Over the content",
    hint: "Always visible.",
  },
  {
    value: "under",
    label: "Under the content",
    hint: "Behind text and pictures; hidden where a page has an opaque background, as scanned pages do.",
  },
];

/** Style of a segmented choice whose native radio is visually hidden. */
const segmentClass =
  "flex min-h-11 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-medium transition-colors hover:bg-muted has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";

interface SettingsPanelProps {
  form: WatermarkForm;
  onChange(patch: Partial<WatermarkForm>): void;
  /** The form's check, for showing problems next to their field. */
  check: FormCheck;
  pageCount: number;
  /** Called with a picture the user picked (validated by the caller). */
  onPickImage(file: File): void;
}

/**
 * Every watermark setting, in the order people decide them: what (text or
 * picture), how it looks, where it goes, which layer, which pages.
 *
 * @param props The form, its check, the page count and handlers.
 * @returns The settings form.
 */
export function SettingsPanel({
  form,
  onChange,
  check,
  pageCount,
  onPickImage,
}: SettingsPanelProps) {
  const kindName = useId();
  const layerName = useId();
  const pagesId = useId();
  const pagesHintId = useId();
  const pagesErrorId = useId();
  const error = (field: string) =>
    !check.ok && check.field === field ? check.message : null;
  const pagesError = error("pages");

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Watermark</legend>
        <div className="bg-muted/30 inline-flex gap-1 rounded-lg border p-1">
          {(
            [
              ["text", "Text"],
              ["image", "Picture"],
            ] as const
          ).map(([kind, label]) => (
            <label key={kind} className={segmentClass}>
              <input
                type="radio"
                name={kindName}
                value={kind}
                checked={form.kind === kind}
                onChange={() => onChange({ kind })}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        {form.kind === "text" ? (
          <TextSettings
            text={form.text}
            onChange={(text) => onChange({ text })}
            error={error("text")}
          />
        ) : (
          <ImageSettings
            imageName={form.image?.name ?? null}
            scale={form.imageScale}
            onPick={onPickImage}
            onScaleChange={(imageScale) => onChange({ imageScale })}
            error={error("image")}
          />
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Appearance</legend>
        <RangeField
          label="Opacity"
          value={form.opacity}
          min={OPACITY_LIMITS.min}
          max={OPACITY_LIMITS.max}
          step={0.05}
          format={percent}
          onChange={(opacity) => onChange({ opacity })}
        />
        <RangeField
          label="Angle"
          value={form.rotation}
          min={ROTATION_LIMITS.min}
          max={ROTATION_LIMITS.max}
          format={(deg) => `${deg}°`}
          onChange={(rotation) => onChange({ rotation })}
        />
        <div className="flex flex-wrap gap-2">
          {ROTATION_PRESETS.map((deg) => (
            <Button
              key={deg}
              variant={form.rotation === deg ? "default" : "outline"}
              className="min-h-11"
              aria-pressed={form.rotation === deg}
              onClick={() => onChange({ rotation: deg })}
            >
              {deg}°
            </Button>
          ))}
        </div>
      </fieldset>

      <PositionPicker
        value={form.position}
        onChange={(position) => onChange({ position })}
      />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Layer</legend>
        {LAYERS.map((layer) => (
          <LayerChoice
            key={layer.value}
            name={layerName}
            layer={layer}
            checked={form.layer === layer.value}
            onSelect={() => onChange({ layer: layer.value })}
          />
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={pagesId} className="text-sm font-medium">
          Pages
        </label>
        <input
          id={pagesId}
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="All pages"
          value={form.pages}
          onChange={(e) => onChange({ pages: e.target.value })}
          aria-invalid={pagesError !== null}
          aria-describedby={cn(pagesHintId, pagesError && pagesErrorId)}
          className={fieldClass}
        />
        <p id={pagesHintId} className="text-muted-foreground text-sm">
          For example 1-3, 5. This PDF has {pageCount}{" "}
          {pageCount === 1 ? "page" : "pages"}.
        </p>
        {pagesError && (
          <p id={pagesErrorId} className="text-destructive text-sm">
            {pagesError}
          </p>
        )}
      </div>
    </div>
  );
}

interface LayerChoiceProps {
  /** The radio group's name. */
  name: string;
  layer: (typeof LAYERS)[number];
  checked: boolean;
  onSelect(): void;
}

/**
 * One layer option. The radio is named by the short label only; the hint
 * is linked as its description, so a screen reader says "Under the
 * content, radio button" and then the explanation, and the name stays
 * short enough to find by.
 *
 * @param props The group name, the option and its state.
 * @returns The option.
 */
function LayerChoice({ name, layer, checked, onSelect }: LayerChoiceProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex gap-3 text-sm">
      <input
        id={id}
        type="radio"
        name={name}
        value={layer.value}
        checked={checked}
        onChange={onSelect}
        aria-describedby={hintId}
        className="accent-primary mt-0.5 size-5 shrink-0 cursor-pointer"
      />
      <div>
        <label htmlFor={id} className="cursor-pointer font-medium">
          {layer.label}
        </label>
        <p id={hintId} className="text-muted-foreground">
          {layer.hint}
        </p>
      </div>
    </div>
  );
}
