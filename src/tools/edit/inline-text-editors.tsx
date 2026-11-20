"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { toSvgTransform, type Matrix } from "./core/affine";
import { rgbToHex } from "./core/colors";
import {
  RUN_EDITOR_LINE_HEIGHT,
  runEditorBox,
  textObjectEditorBox,
  type LocalRect,
} from "./core/inline-editing";
import { MAX_TEXT_LENGTH, type TextObject } from "./core/model";
import { LINE_HEIGHT, type FontMetricsSource } from "./core/text-layout";
import type { TextRun } from "./core/text-runs";
import { PREVIEW_FONT_FAMILY } from "./object-shape";
import { cleanTypedText } from "./text-input";

/** Marks inline editors, so the overlay can find and close the open one. */
export const INLINE_EDITOR_ATTR = "data-inline-editor";

/**
 * Close whichever inline editor has focus, committing its text (both
 * editors commit on blur). Does nothing if none has focus.
 *
 * @returns Whether an editor was closed.
 */
export function closeInlineEditor(): boolean {
  const active =
    typeof document === "undefined" ? null : document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.closest(`[${INLINE_EDITOR_ATTR}]`)
  ) {
    active.blur();
    return true;
  }
  return false;
}

/** Keeps a pointer or mouse event from reaching the page overlay. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Base styles of an inline field: transparent, borderless, no padding, so
 * the only thing drawn is the typed text (and a thin dashed outline that
 * shows where typing goes). Nothing covers the page.
 */
const FIELD_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  margin: 0,
  padding: 0,
  border: "none",
  background: "transparent",
  outline: "1px dashed #2563eb",
  outlineOffset: 1,
  overflow: "hidden",
  whiteSpace: "pre",
};

/**
 * An HTML field placed in the page's SVG.
 *
 * `foreignObject` lets HTML live inside SVG, transformed like any SVG
 * element: content laid out in CSS pixels is drawn in the transformed
 * local units (points), so the field turns and scales with the page.
 * Pointer and mouse presses are kept inside: the overlay must neither
 * treat them as clicks on the page nor cancel the mousedown that places
 * the caret.
 *
 * @param props Placement and the field.
 * @returns The SVG element.
 */
function FieldInSvg({
  transform,
  rect,
  children,
}: {
  transform: Matrix;
  rect: LocalRect;
  children: ReactNode;
}) {
  return (
    <foreignObject
      transform={toSvgTransform(transform)}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      overflow="visible"
      className="select-text"
      onPointerDown={stop}
      onMouseDown={stop}
    >
      {children}
    </foreignObject>
  );
}

interface RunTextEditorProps {
  run: TextRun;
  /** The line-to-view transform (see `runToView`). */
  transform: Matrix;
  /** Text to start from: the current edit, or the line's own text. */
  initialText: string;
  /** Called with the final text when the field loses focus. */
  onCommit(text: string): void;
  /** Called on Escape; nothing is changed. */
  onCancel(): void;
}

/**
 * Edits one existing line of the PDF in place.
 *
 * The page underneath is rendered without this line while the field is
 * open (see `PageView`), so the field's text is the only text there: no
 * box is painted over the original. The field matches the line's position,
 * size, colour and style; its baseline is placed on the line's baseline.
 *
 * Keys: Enter applies, Escape cancels. Leaving the field also applies, so
 * clicking elsewhere never loses typing.
 *
 * @param props The line and callbacks.
 * @returns The field.
 */
export function RunTextEditor({
  run,
  transform,
  initialText,
  onCommit,
  onCancel,
}: RunTextEditorProps) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const { family, bold, italic } = run.style;
  return (
    <FieldInSvg transform={transform} rect={runEditorBox(run)}>
      <input
        ref={ref}
        {...{ [INLINE_EDITOR_ATTR]: "" }}
        type="text"
        aria-label={`Edit text: ${run.text.trim()}`}
        maxLength={MAX_TEXT_LENGTH}
        spellCheck={false}
        value={text}
        style={{
          ...FIELD_STYLE,
          fontFamily: PREVIEW_FONT_FAMILY[family],
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? "italic" : "normal",
          fontSize: `${run.fontSize}px`,
          lineHeight: `${run.fontSize * RUN_EDITOR_LINE_HEIGHT}px`,
          color: rgbToHex(run.color),
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            // Handled here: the editor's global Escape must not also run.
            e.stopPropagation();
            cancelled.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          if (!cancelled.current) onCommit(text);
        }}
      />
    </FieldInSvg>
  );
}

interface ObjectTextEditorProps {
  object: TextObject;
  /** The object's local-to-view transform. */
  transform: Matrix;
  metrics: FontMetricsSource;
  /** Called with the cleaned text on every change. */
  onChange(text: string): void;
  /** Called when editing ends (blur, Escape, or Ctrl/Cmd+Enter). */
  onDone(): void;
}

/**
 * Edits an added text object where it sits on the page.
 *
 * The object's own preview is hidden while this is open (see
 * `PageOverlay`), so the text area shows the only copy. It grows with the
 * text and shares the preview's font, size, colour, line spacing and first
 * baseline. Enter adds a line; Escape or Ctrl/Cmd+Enter finishes.
 *
 * @param props The object and callbacks.
 * @returns The text area.
 */
export function ObjectTextEditor({
  object,
  transform,
  metrics,
  onChange,
  onDone,
}: ObjectTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <FieldInSvg
      transform={transform}
      rect={textObjectEditorBox(object, metrics)}
    >
      <textarea
        ref={ref}
        {...{ [INLINE_EDITOR_ATTR]: "" }}
        aria-label="Text on the page"
        maxLength={MAX_TEXT_LENGTH}
        spellCheck={false}
        value={object.text}
        style={{
          ...FIELD_STYLE,
          resize: "none",
          fontFamily: PREVIEW_FONT_FAMILY[object.font],
          fontSize: `${object.fontSize}px`,
          lineHeight: `${object.fontSize * LINE_HEIGHT}px`,
          color: rgbToHex(object.color),
        }}
        onChange={(e) =>
          onChange(cleanTypedText(e.target.value, object.font, metrics))
        }
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.currentTarget.blur();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={onDone}
      />
    </FieldInSvg>
  );
}
