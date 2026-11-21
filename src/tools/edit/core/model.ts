/**
 * The PDF editor's data model. Plain, JSON-serialisable types shared by the
 * UI, the pure core and the worker, so an edit can cross the thread boundary
 * as-is.
 *
 * Coordinates: every object lives in the **PDF user space of its page**
 * (points, 1/72 inch, y axis pointing up), not in screen pixels. That keeps an
 * object glued to the paper when the page is rotated or shown at another zoom
 * level, and it is the space PDFium writes in. See `page-geometry.ts` and
 * `object-frame.ts` for the conversions to and from the screen.
 */

import type { Point } from "@/lib/affine";
import type { Rgb } from "@/lib/color";
import type { ImageMime } from "@/lib/image-info";
import type { QuarterTurns } from "@/lib/pdfium/page-box";

// Points, colours, image formats and page geometry are shared with other
// tools; they are part of the editor's model too, so they are re-exported here.
export type { Point } from "@/lib/affine";
export type { Rgb } from "@/lib/color";
export type { ImageMime } from "@/lib/image-info";
export type { PageBox, PageInfo, QuarterTurns } from "@/lib/pdfium/page-box";

/**
 * Text font families. Each maps to one of the PDF "standard 14" fonts, which
 * every PDF reader has built in, so nothing needs to be embedded.
 */
export type FontFamily = "sans" | "serif" | "mono";

/**
 * Where an object sits on its page and which way it faces.
 *
 * Each object has its own local coordinate system ("local space"): `u` grows
 * to the right and `v` grows downwards, exactly like reading the object
 * upright. `(x, y)` is the user-space position of the local origin (the
 * object's top-left corner as it is read), and `rotation` is how many quarter
 * turns, counter-clockwise in user space, the local axes are turned.
 */
export interface ObjectFrame {
  /** Unique within the document; used by the UI only. */
  id: string;
  /** User-space x of the local origin, in points. */
  x: number;
  /** User-space y of the local origin, in points. */
  y: number;
  /** Counter-clockwise quarter turns of the local axes in user space. */
  rotation: QuarterTurns;
}

/** One or more lines of text in a standard font. */
export interface TextObject extends ObjectFrame {
  kind: "text";
  /** The text; "\n" separates lines. Only WinAnsi characters are allowed. */
  text: string;
  font: FontFamily;
  /** Font size in points. */
  fontSize: number;
  color: Rgb;
}

/** A freehand pen stroke. */
export interface InkObject extends ObjectFrame {
  kind: "ink";
  /** Stroke vertices in local space, in drawing order. */
  points: Point[];
  color: Rgb;
  /** Pen width in points. */
  strokeWidth: number;
}

/** Fields shared by the objects that occupy a rectangle in local space. */
interface BoxFields {
  /** Width of the box in local space, in points. */
  width: number;
  /** Height of the box in local space, in points. */
  height: number;
}

/** An outlined rectangle. */
export interface RectObject extends ObjectFrame, BoxFields {
  kind: "rect";
  color: Rgb;
  /** Outline width in points. */
  strokeWidth: number;
}

/** A translucent marker rectangle, blended like a highlighter pen. */
export interface HighlightObject extends ObjectFrame, BoxFields {
  kind: "highlight";
  color: Rgb;
}

/** A PNG or JPEG picture, such as a scanned signature. */
export interface ImageObject extends ObjectFrame, BoxFields {
  kind: "image";
  /** Key into the document's image assets. */
  imageId: string;
}

/** Anything the user can add to a page. */
export type EditObject =
  TextObject | InkObject | RectObject | HighlightObject | ImageObject;

/** The `kind` discriminator of {@link EditObject}. */
export type EditObjectKind = EditObject["kind"];

/** The objects that are sized by a width and a height. */
export type BoxObject = RectObject | HighlightObject | ImageObject;

/** The bytes behind an {@link ImageObject}. Kept outside undo history. */
export interface ImageAsset {
  id: string;
  mime: ImageMime;
  /** The original file bytes (PNG or JPEG). */
  bytes: ArrayBuffer;
  /** Intrinsic size in pixels, used for the aspect ratio. */
  pixelWidth: number;
  pixelHeight: number;
}

/** One page in the editor, in output order. */
export interface EditorPage {
  /** Stable React key, independent of the page's position. */
  key: string;
  /** Index of this page in the opened file. */
  sourceIndex: number;
  /** Clockwise quarter turns the user added on top of the page's /Rotate. */
  rotation: QuarterTurns;
  /** Added objects, bottom-most first (later objects paint over earlier ones). */
  objects: EditObject[];
  /**
   * Changes to the page's own text, by line id (see `TextRun.id`): the new
   * text of each edited line. An empty string deletes the line.
   */
  textEdits: Readonly<Record<string, string>>;
}

/** New text for one line of the page's own text. */
export interface TextEdit {
  /** The line's id (its text objects' indices joined by "-"). */
  runId: string;
  /** The new text; empty deletes the line. */
  text: string;
}

/**
 * Why a text edit left the line unchanged:
 * - "line-not-found": the line is not on the page (any more);
 * - "no-font": neither the line's own font nor any standard font can write
 *   a single typed character (e.g. Hebrew or Devanagari), so writing would
 *   only erase the line.
 */
export type TextEditFailure = "line-not-found" | "no-font";

/** What happened when a text edit was written into the page. */
export interface TextEditOutcome {
  runId: string;
  /** False when nothing was changed; `failure` says why. */
  applied: boolean;
  /** Why nothing was changed, or `null` when the edit was applied. */
  failure: TextEditFailure | null;
  /** The text actually written (characters no font could show removed). */
  written: string;
  /**
   * The standard font used instead of the original one, when the original
   * (embedded subset) font lacks a typed character; `null` when the
   * original font was kept.
   */
  substituteFont: string | null;
}

/** The undoable part of the editor: pages (order, rotation), objects and text edits. */
export interface EditorDocument {
  pages: EditorPage[];
}

/** Allowed font sizes, in points. */
export const FONT_SIZE_LIMITS = { min: 4, max: 144 } as const;

/** Allowed pen and outline widths, in points. */
export const STROKE_WIDTH_LIMITS = { min: 0.5, max: 24 } as const;

/** Longest text a single text object may hold, in UTF-16 code units. */
export const MAX_TEXT_LENGTH = 5000;

/** Most vertices a single ink stroke may hold. */
export const MAX_INK_POINTS = 5000;

/** Largest coordinate magnitude accepted, in points (about 35 metres). */
export const MAX_COORDINATE = 100_000;

/** Opacity of highlight rectangles. */
export const HIGHLIGHT_OPACITY = 0.4;
