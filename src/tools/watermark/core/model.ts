/**
 * The watermark tool's data model: plain, JSON-serialisable types shared by
 * the UI, the pure core and the worker, so settings cross the thread
 * boundary as-is.
 *
 * Coordinates: a watermark is laid out on the page **as it is displayed**
 * (after the page's own /Rotate), in points, with the origin at the bottom
 * left and y pointing up. "Top-left" therefore means the top-left corner the
 * reader sees, whatever the page's rotation.
 */
import type { Rgb } from "@/lib/color";
import type { ImageMime } from "@/lib/image-info";

/**
 * Font families for text watermarks. Each is one of the PDF "standard 14"
 * fonts, which every PDF reader has built in, so nothing is embedded.
 */
export type WatermarkFont = "helvetica" | "times" | "courier";

/** Font families in display order. */
export const WATERMARK_FONTS: readonly WatermarkFont[] = [
  "helvetica",
  "times",
  "courier",
];

/** A text watermark, as the UI describes it. */
export interface TextContent {
  kind: "text";
  /** The text; "\n" separates lines. Only WinAnsi characters are allowed. */
  text: string;
  font: WatermarkFont;
  bold: boolean;
  /** Font size in points. */
  fontSize: number;
  color: Rgb;
}

/** A picture watermark (PNG or JPEG), as the UI describes it. */
export interface ImageContent {
  kind: "image";
  /** The original file bytes (copied, not transferred, to the worker). */
  bytes: ArrayBuffer;
  /** Width of the picture as a fraction of the page's displayed width. */
  scale: number;
}

/** What is drawn. */
export type WatermarkContent = TextContent | ImageContent;

/** The nine places a single watermark can be anchored to. */
export const ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

/** One of {@link ANCHORS}. */
export type Anchor = (typeof ANCHORS)[number];

/** A single copy at an anchor, or copies repeated across the whole page. */
export type Position = Anchor | "tile";

/** Above the page content (always visible) or below it. */
export type Layer = "over" | "under";

/** Everything the user chose, as sent to the worker. */
export interface WatermarkSettings {
  content: WatermarkContent;
  /** 0..1, where 1 is fully opaque. */
  opacity: number;
  /** Degrees, counter-clockwise as the reader sees the page. */
  rotation: number;
  position: Position;
  layer: Layer;
}

/** A text watermark after validation (see `sanitizeSettings`). */
export type TextSpec = TextContent;

/** A picture watermark after validation: format and size read from its bytes. */
export interface ImageSpec {
  kind: "image";
  mime: ImageMime;
  bytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  scale: number;
}

/** Validated settings: every value is known to be in range. */
export interface WatermarkSpec {
  content: TextSpec | ImageSpec;
  opacity: number;
  rotation: number;
  position: Position;
  layer: Layer;
}

/** Allowed font sizes, in points. */
export const FONT_SIZE_LIMITS = { min: 6, max: 400 } as const;

/** Allowed opacities. Fully transparent would draw nothing. */
export const OPACITY_LIMITS = { min: 0.05, max: 1 } as const;

/** Allowed picture widths, as a fraction of the page's displayed width. */
export const IMAGE_SCALE_LIMITS = { min: 0.05, max: 1 } as const;

/** Allowed rotations, in degrees. */
export const ROTATION_LIMITS = { min: -180, max: 180 } as const;

/** Longest watermark text, in UTF-16 code units. */
export const MAX_TEXT_LENGTH = 500;

/** Most lines a text watermark may have. */
export const MAX_TEXT_LINES = 10;

/** Distance between consecutive baselines, as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;

/** A diagonal, semi-transparent grey "CONFIDENTIAL" across the middle. */
export const DEFAULT_TEXT_CONTENT: TextContent = {
  kind: "text",
  text: "CONFIDENTIAL",
  font: "helvetica",
  bold: true,
  fontSize: 60,
  color: { r: 128, g: 128, b: 128 },
};

/** Default picture width: 40% of the page width. */
export const DEFAULT_IMAGE_SCALE = 0.4;

/** The settings a new session starts with. */
export const DEFAULT_SETTINGS: WatermarkSettings = {
  content: DEFAULT_TEXT_CONTENT,
  opacity: 0.3,
  rotation: 45,
  position: "center",
  layer: "over",
};
