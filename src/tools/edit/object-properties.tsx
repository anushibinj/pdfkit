"use client";

import { Trash2, X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { ColorField, NumberField, fieldClass } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import type { ObjectPatch } from "./core/editor-state";
import type { DrawingTool, ToolStyle } from "./core/gestures";
import {
  FONT_SIZE_LIMITS,
  STROKE_WIDTH_LIMITS,
  type EditObject,
  type FontFamily,
  type TextObject,
} from "./core/model";
import { stripUnsupported, type FontMetricsSource } from "./core/text-layout";
import { cleanTypedText } from "./text-input";

/** Font choices, labelled with the PDF font each one uses. */
export const FONT_OPTIONS: readonly { value: FontFamily; label: string }[] = [
  { value: "sans", label: "Sans serif (Helvetica)" },
  { value: "serif", label: "Serif (Times)" },
  { value: "mono", label: "Monospace (Courier)" },
];

/** What each tool does, shown when nothing is selected. */
export const TOOL_HINTS: Record<DrawingTool, string> = {
  select:
    "Click an item to select it, then drag to move it. Arrow keys nudge it; Delete removes it. Double-click added text to change it.",
  "edit-text":
    "Click any line of the PDF's text and type to change it in place. Enter applies, Esc cancels; empty the line to delete it.",
  text: "Click on a page to add text, and type it right there.",
  ink: "Draw on a page with your mouse, finger or pen.",
  rect: "Drag on a page to draw a box.",
  highlight: "Drag over text to highlight it.",
};

/**
 * A labelled font family picker.
 *
 * @param props Font and change handler.
 * @returns The field.
 */
export function FontField({
  value,
  onChange,
}: {
  value: FontFamily;
  onChange(value: FontFamily): void;
}) {
  const id = useId();
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Font
      </label>
      <select
        id={id}
        className={fieldClass}
        value={value}
        onChange={(e) => {
          const option = FONT_OPTIONS.find((o) => o.value === e.target.value);
          if (option) onChange(option.value);
        }}
      >
        {FONT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface TextContentFieldProps {
  object: TextObject;
  metrics: FontMetricsSource;
  onChange(text: string): void;
}

/**
 * The text area that edits a text object's content from the panel. The
 * same text can be typed on the page itself (`ObjectTextEditor`); this
 * field is the keyboard-friendly alternative and shows the whole text.
 *
 * Every change goes through `cleanTypedText`, as on the page. The field is
 * one line tall to fit the panel; Enter still adds lines, and the field
 * scrolls.
 *
 * @param props The object and callback.
 * @returns The field.
 */
export function TextContentField({
  object,
  metrics,
  onChange,
}: TextContentFieldProps) {
  const id = useId();
  return (
    <div className="flex min-w-60 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Text content
      </label>
      <textarea
        id={id}
        rows={1}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-11 w-full resize-none rounded-lg border bg-transparent px-3 py-2.5 text-base outline-none focus-visible:ring-3 md:text-sm"
        value={object.text}
        onChange={(e) =>
          onChange(cleanTypedText(e.target.value, object.font, metrics))
        }
      />
    </div>
  );
}

/**
 * The panel's frame: one row of fixed height.
 *
 * The height never changes, whatever is selected. The panel sits in the
 * sticky bar above the pages, so a panel that grew (say, when a text box is
 * selected and its text field appears) would push every page down while
 * the user is pointing at it, and an object being dragged would jump. On
 * narrow screens the row scrolls sideways instead of wrapping.
 *
 * @param props The controls to show.
 * @returns The row.
 */
function PanelRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[5.5rem] items-end gap-4 overflow-x-auto overflow-y-hidden pb-1">
      {children}
    </div>
  );
}

/**
 * A hint line, clamped to three lines so it fits the fixed-height panel.
 *
 * @param props The hint.
 * @returns The paragraph.
 */
function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground line-clamp-3 min-w-48 flex-1 self-center text-sm">
      {children}
    </p>
  );
}

export interface ObjectPropertiesProps {
  tool: DrawingTool;
  style: ToolStyle;
  onStyleChange(patch: Partial<ToolStyle>): void;
  /** The selected object, if any. */
  selected: EditObject | null;
  /** Update the selected object; the key groups repeated edits for undo. */
  onUpdate(patch: ObjectPatch, coalesceKey: string): void;
  onDelete(): void;
  /** Name of an image waiting to be placed, if any. */
  pendingImageName: string | null;
  onCancelImage(): void;
  metrics: FontMetricsSource;
}

/**
 * Context controls under the toolbar, in a fixed-height row (see
 * `PanelRow` for why the height must not change).
 *
 * Shows, in order of priority:
 * 1. placing an image: what to do, and a way to cancel;
 * 2. a selected object: its own settings and a delete button (changes go to
 *    the object, as one undo step per setting being adjusted);
 * 3. otherwise: the active tool's style for new objects, and a hint.
 *
 * @param props Tool, style, selection and callbacks.
 * @returns The panel.
 */
export function ObjectProperties(props: ObjectPropertiesProps) {
  const { selected, style, onStyleChange, onUpdate } = props;

  if (props.pendingImageName !== null) {
    return (
      <PanelRow>
        <p className="line-clamp-3 min-w-48 flex-1 self-center text-sm">
          Click on a page to place{" "}
          <span className="font-medium break-all">
            {props.pendingImageName}
          </span>
          .
        </p>
        <Button
          variant="outline"
          className="min-h-11 shrink-0"
          onClick={props.onCancelImage}
        >
          <X aria-hidden="true" /> Cancel
        </Button>
      </PanelRow>
    );
  }

  if (selected) {
    const key = (field: string) => `${field}:${selected.id}`;
    return (
      <PanelRow>
        {selected.kind === "text" && (
          <>
            <TextContentField
              key={selected.id}
              object={selected}
              metrics={props.metrics}
              onChange={(text) => onUpdate({ text }, key("text"))}
            />
            <FontField
              value={selected.font}
              onChange={(font) =>
                // A new font may not have every glyph of the old one; all
                // three share WinAnsi today, but strip anyway to stay safe.
                onUpdate(
                  {
                    font,
                    text: stripUnsupported(selected.text, font, props.metrics)
                      .text,
                  },
                  key("font"),
                )
              }
            />
            <NumberField
              label="Size (pt)"
              value={selected.fontSize}
              limits={FONT_SIZE_LIMITS}
              onChange={(fontSize) => onUpdate({ fontSize }, key("size"))}
            />
          </>
        )}
        {(selected.kind === "text" ||
          selected.kind === "ink" ||
          selected.kind === "rect" ||
          selected.kind === "highlight") && (
          <ColorField
            label="Colour"
            value={selected.color}
            onChange={(color) => onUpdate({ color }, key("color"))}
          />
        )}
        {(selected.kind === "ink" || selected.kind === "rect") && (
          <NumberField
            label="Width (pt)"
            value={selected.strokeWidth}
            limits={STROKE_WIDTH_LIMITS}
            step={0.5}
            onChange={(strokeWidth) => onUpdate({ strokeWidth }, key("width"))}
          />
        )}
        <Button
          variant="destructive"
          className="min-h-11 shrink-0"
          onClick={props.onDelete}
        >
          <Trash2 aria-hidden="true" /> Delete
        </Button>
      </PanelRow>
    );
  }

  const tool = props.tool;
  return (
    <PanelRow>
      {tool === "text" && (
        <>
          <FontField
            value={style.font}
            onChange={(font) => onStyleChange({ font })}
          />
          <NumberField
            label="Size (pt)"
            value={style.fontSize}
            limits={FONT_SIZE_LIMITS}
            onChange={(fontSize) => onStyleChange({ fontSize })}
          />
          <ColorField
            label="Colour"
            value={style.textColor}
            onChange={(textColor) => onStyleChange({ textColor })}
          />
        </>
      )}
      {(tool === "ink" || tool === "rect") && (
        <>
          <ColorField
            label="Colour"
            value={style.color}
            onChange={(color) => onStyleChange({ color })}
          />
          <NumberField
            label="Width (pt)"
            value={style.strokeWidth}
            limits={STROKE_WIDTH_LIMITS}
            step={0.5}
            onChange={(strokeWidth) => onStyleChange({ strokeWidth })}
          />
        </>
      )}
      {tool === "highlight" && (
        <ColorField
          label="Colour"
          value={style.highlightColor}
          onChange={(highlightColor) => onStyleChange({ highlightColor })}
        />
      )}
      <Hint>{TOOL_HINTS[tool]}</Hint>
    </PanelRow>
  );
}
