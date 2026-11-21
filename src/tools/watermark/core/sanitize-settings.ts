import { clampChannel, type Rgb } from "@/lib/color";
import { MAX_IMAGE_BYTES, readImageInfo } from "@/lib/image-info";
import { formatBytes } from "@/lib/format";
import {
  ANCHORS,
  DEFAULT_IMAGE_SCALE,
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_CONTENT,
  FONT_SIZE_LIMITS,
  IMAGE_SCALE_LIMITS,
  MAX_TEXT_LENGTH,
  MAX_TEXT_LINES,
  OPACITY_LIMITS,
  WATERMARK_FONTS,
  type ImageSpec,
  type Layer,
  type Position,
  type TextSpec,
  type WatermarkFont,
  type WatermarkSpec,
} from "./model";
import {
  normalizeWatermarkText,
  textLines,
  unsupportedCharacters,
} from "./text";

/** Settings that cannot be used as they are; the message says why. */
export class InvalidSettingsError extends Error {
  /** @param message What is wrong, written for the user. */
  constructor(message: string) {
    super(message);
    this.name = "InvalidSettingsError";
  }
}

/** A plain object with unknown values (anything that crossed a thread). */
type Untrusted = Record<string, unknown>;

/**
 * @param value Anything.
 * @returns `true` for non-null, non-array objects.
 */
function isObject(value: unknown): value is Untrusted {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Force a number into a range, with a fallback for non-numbers.
 *
 * @param value Anything.
 * @param limits The allowed range.
 * @param fallback Used when `value` is not a finite number (NaN from an
 *   empty number field, a string, undefined).
 * @returns A number within `limits`.
 */
export function clampNumber(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, value));
}

/**
 * Bring an angle into -180..180 degrees.
 *
 * Angles repeat every 360°, so 270° is wrapped to -90° (the same direction)
 * instead of being clamped to 180° (a different one). `((x % 360) + 360) %
 * 360` handles negative inputs, because JavaScript's `%` keeps the sign of
 * the left operand.
 *
 * @param value Anything.
 * @param fallback Used when `value` is not a finite number.
 * @returns An angle in [-180, 180).
 */
export function normalizeRotation(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

/**
 * Read a colour, clamping each channel.
 *
 * @param value Anything.
 * @param fallback Used when `value` is not an object.
 * @returns A valid colour.
 */
function sanitizeColor(value: unknown, fallback: Rgb): Rgb {
  if (!isObject(value)) return fallback;
  return {
    r: clampChannel(Number(value.r)),
    g: clampChannel(Number(value.g)),
    b: clampChannel(Number(value.b)),
  };
}

/**
 * Validate a text watermark.
 *
 * The text is normalised first (line breaks, tabs, outer blank lines), then
 * refused when it is empty, too long, has too many lines, or contains
 * characters the standard fonts cannot write (PDFium would silently turn
 * them into "ÿ"). Other fields fall back to defaults or are clamped.
 *
 * @param raw The content object from the message.
 * @returns A usable text spec.
 * @throws {InvalidSettingsError} For unusable text.
 */
export function sanitizeTextContent(raw: Untrusted): TextSpec {
  const text = normalizeWatermarkText(
    typeof raw.text === "string" ? raw.text : "",
  );
  if (text === "") throw new InvalidSettingsError("Type the watermark text.");
  if (text.length > MAX_TEXT_LENGTH) {
    throw new InvalidSettingsError(
      `The watermark text is too long (at most ${MAX_TEXT_LENGTH} characters).`,
    );
  }
  if (textLines(text).length > MAX_TEXT_LINES) {
    throw new InvalidSettingsError(
      `The watermark text has too many lines (at most ${MAX_TEXT_LINES}).`,
    );
  }
  const unsupported = unsupportedCharacters(text);
  if (unsupported.length > 0) {
    throw new InvalidSettingsError(
      `These characters cannot be written in the standard PDF fonts: ${unsupported.join(" ")}`,
    );
  }
  const font: WatermarkFont = WATERMARK_FONTS.includes(
    raw.font as WatermarkFont,
  )
    ? (raw.font as WatermarkFont)
    : DEFAULT_TEXT_CONTENT.font;
  return {
    kind: "text",
    text,
    font,
    bold: raw.bold === true,
    fontSize: clampNumber(
      raw.fontSize,
      FONT_SIZE_LIMITS,
      DEFAULT_TEXT_CONTENT.fontSize,
    ),
    color: sanitizeColor(raw.color, DEFAULT_TEXT_CONTENT.color),
  };
}

/**
 * Validate a picture watermark.
 *
 * The format is identified from the bytes themselves (PNG or JPEG
 * signature and header), never from a name or MIME type, and the pixel
 * size read from the header gives the aspect ratio.
 *
 * @param raw The content object from the message.
 * @returns A usable image spec (bytes viewed, not copied).
 * @throws {InvalidSettingsError} When the bytes are missing, too large, or
 *   not a PNG or JPEG.
 */
export function sanitizeImageContent(raw: Untrusted): ImageSpec {
  if (!(raw.bytes instanceof ArrayBuffer) || raw.bytes.byteLength === 0) {
    throw new InvalidSettingsError("Choose a picture for the watermark.");
  }
  if (raw.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new InvalidSettingsError(
      `The picture is larger than ${formatBytes(MAX_IMAGE_BYTES)}.`,
    );
  }
  const bytes = new Uint8Array(raw.bytes);
  const info = readImageInfo(bytes);
  if (!info) {
    throw new InvalidSettingsError("The picture is not a PNG or JPEG image.");
  }
  return {
    kind: "image",
    mime: info.mime,
    bytes,
    pixelWidth: info.width,
    pixelHeight: info.height,
    scale: clampNumber(raw.scale, IMAGE_SCALE_LIMITS, DEFAULT_IMAGE_SCALE),
  };
}

/**
 * Validate watermark settings that arrived from another thread.
 *
 * The worker must never trust a message: it can carry anything. Numbers are
 * clamped into their ranges (or replaced by defaults when they are not
 * numbers), unknown choices fall back to defaults, and only content that
 * cannot be drawn correctly is refused.
 *
 * @param raw The settings from the message.
 * @returns Settings in which every value is valid.
 * @throws {InvalidSettingsError} When there is nothing valid to draw.
 */
export function sanitizeSettings(raw: unknown): WatermarkSpec {
  if (!isObject(raw) || !isObject(raw.content)) {
    throw new InvalidSettingsError("The watermark settings are missing.");
  }
  const content =
    raw.content.kind === "text"
      ? sanitizeTextContent(raw.content)
      : raw.content.kind === "image"
        ? sanitizeImageContent(raw.content)
        : null;
  if (!content) {
    throw new InvalidSettingsError("Choose a text or a picture watermark.");
  }
  const position: Position =
    raw.position === "tile" || ANCHORS.includes(raw.position as never)
      ? (raw.position as Position)
      : DEFAULT_SETTINGS.position;
  const layer: Layer = raw.layer === "under" ? "under" : "over";
  return {
    content,
    opacity: clampNumber(raw.opacity, OPACITY_LIMITS, DEFAULT_SETTINGS.opacity),
    rotation: normalizeRotation(raw.rotation, DEFAULT_SETTINGS.rotation),
    position,
    layer,
  };
}

/**
 * Validate the pages to watermark.
 *
 * The UI only sends indices it parsed from the page range field, so an
 * invalid list means a bug or a forged message; it is refused rather than
 * guessed at. Duplicates are dropped and the order made ascending (qpdf's
 * `--to` list must name each page once).
 *
 * @param raw The page indices from the message.
 * @param pageCount How many pages the open PDF has.
 * @returns Unique, ascending 0-based indices (at least one).
 * @throws {InvalidSettingsError} For a missing, empty or out-of-range list.
 */
export function sanitizePageIndices(raw: unknown, pageCount: number): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InvalidSettingsError("Choose at least one page.");
  }
  const pages = new Set<number>();
  for (const value of raw) {
    if (!Number.isInteger(value) || value < 0 || value >= pageCount) {
      throw new InvalidSettingsError("The page selection is not valid.");
    }
    pages.add(value as number);
  }
  return [...pages].sort((a, b) => a - b);
}
