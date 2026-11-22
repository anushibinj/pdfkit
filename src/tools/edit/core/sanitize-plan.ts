import { clampChannel } from "./colors";
import {
  FONT_SIZE_LIMITS,
  MAX_COORDINATE,
  MAX_INK_POINTS,
  MAX_TEXT_LENGTH,
  STROKE_WIDTH_LIMITS,
  type EditObject,
  type EditObjectKind,
  type FontFamily,
  type ImageMime,
  type ObjectFrame,
  type Point,
  type Rgb,
  type TextEdit,
} from "./model";
import { isQuarterTurns } from "@/lib/geometry/page-geometry";
import type { SaveImage, SavePage, SavePlan } from "./save-plan";
import {
  normalizeTextInput,
  stripUnsupported,
  type FontMetricsSource,
} from "./text-layout";

/** The plan's structure is unusable (as opposed to one bad object in it). */
export class InvalidPlanError extends Error {
  /** @param message What is wrong with the plan. */
  constructor(message: string) {
    super(message);
    this.name = "InvalidPlanError";
  }
}

/** Font size used when a text object's size is not a number. */
export const DEFAULT_FONT_SIZE = 14;
/** Pen width used when a stroke width is not a number. */
export const DEFAULT_STROKE_WIDTH = 2;

const FONT_FAMILIES: readonly FontFamily[] = ["sans", "serif", "mono"];
const IMAGE_MIMES: readonly ImageMime[] = ["image/png", "image/jpeg"];
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Shared inputs for the per-kind sanitisers. */
interface SanitizeContext {
  metrics: FontMetricsSource;
  /** Ids of the images that were actually sent with the plan. */
  imageIds: ReadonlySet<string>;
}

/** Validates the kind-specific fields of one object; `null` drops it. */
type KindSanitizer = (
  raw: Record<string, unknown>,
  frame: ObjectFrame,
  ctx: SanitizeContext,
) => EditObject | null;

/**
 * True for plain objects (not `null`, not arrays).
 *
 * @param value Anything.
 * @returns Whether its fields can be read.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a coordinate: a finite number no further than {@link MAX_COORDINATE}
 * from zero. Huge values would put content kilometres off the page and can
 * overflow PDFium's float math.
 *
 * @param value Anything.
 * @returns The number, or `null` when it is not a usable coordinate.
 */
export function readCoordinate(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_COORDINATE
    ? value
    : null;
}

/**
 * Read a width or height: a finite number above zero and at most twice
 * {@link MAX_COORDINATE}.
 *
 * @param value Anything.
 * @returns The size, or `null` when it is not usable.
 */
export function readSize(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 2 * MAX_COORDINATE
    ? value
    : null;
}

/**
 * Read a number and force it into a range.
 *
 * @param value Anything.
 * @param limits Inclusive range.
 * @param fallback Used when `value` is not a finite number.
 * @returns A number within `limits`.
 */
export function readClamped(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, value));
}

/**
 * Read a colour, clamping each channel into 0..255.
 *
 * @param value Anything.
 * @param fallback Used when `value` is not an object.
 * @returns A valid colour.
 */
export function readColor(value: unknown, fallback: Rgb): Rgb {
  if (!isRecord(value)) return fallback;
  return {
    r: clampChannel(Number(value.r)),
    g: clampChannel(Number(value.g)),
    b: clampChannel(Number(value.b)),
  };
}

/**
 * Read a list of ink points, skipping unusable ones and keeping at most
 * {@link MAX_INK_POINTS}.
 *
 * @param value Anything.
 * @returns The valid points (possibly none).
 */
export function readPoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  const points: Point[] = [];
  for (const p of value) {
    if (points.length >= MAX_INK_POINTS) break;
    if (!isRecord(p)) continue;
    const x = readCoordinate(p.x);
    const y = readCoordinate(p.y);
    if (x !== null && y !== null) points.push({ x, y });
  }
  return points;
}

/**
 * Width and height for box-shaped objects, or `null` if either is unusable.
 *
 * @param raw The raw object.
 * @returns The two sizes.
 */
function readBox(
  raw: Record<string, unknown>,
): { width: number; height: number } | null {
  const width = readSize(raw.width);
  const height = readSize(raw.height);
  return width === null || height === null ? null : { width, height };
}

/**
 * One sanitiser per object kind. Supporting a new kind means adding an entry
 * here (and a writer in the engine); no existing code has to change.
 */
const SANITIZERS: Record<EditObjectKind, KindSanitizer> = {
  text(raw, frame, ctx) {
    const font = FONT_FAMILIES.includes(raw.font as FontFamily)
      ? (raw.font as FontFamily)
      : "sans";
    const normalized = normalizeTextInput(
      typeof raw.text === "string" ? raw.text : "",
    ).slice(0, MAX_TEXT_LENGTH);
    // Slicing can cut an emoji in half; the lone half is not writable and is
    // removed here together with every other unsupported character.
    const { text } = stripUnsupported(normalized, font, ctx.metrics);
    if (text.trim() === "") return null;
    return {
      ...frame,
      kind: "text",
      text,
      font,
      fontSize: readClamped(raw.fontSize, FONT_SIZE_LIMITS, DEFAULT_FONT_SIZE),
      color: readColor(raw.color, BLACK),
    };
  },
  ink(raw, frame) {
    const points = readPoints(raw.points);
    if (points.length === 0) return null;
    return {
      ...frame,
      kind: "ink",
      points,
      color: readColor(raw.color, BLACK),
      strokeWidth: readClamped(
        raw.strokeWidth,
        STROKE_WIDTH_LIMITS,
        DEFAULT_STROKE_WIDTH,
      ),
    };
  },
  rect(raw, frame) {
    const box = readBox(raw);
    if (!box) return null;
    return {
      ...frame,
      ...box,
      kind: "rect",
      color: readColor(raw.color, BLACK),
      strokeWidth: readClamped(
        raw.strokeWidth,
        STROKE_WIDTH_LIMITS,
        DEFAULT_STROKE_WIDTH,
      ),
    };
  },
  highlight(raw, frame) {
    const box = readBox(raw);
    if (!box) return null;
    return {
      ...frame,
      ...box,
      kind: "highlight",
      color: readColor(raw.color, BLACK),
    };
  },
  image(raw, frame, ctx) {
    const box = readBox(raw);
    const imageId = raw.imageId;
    if (!box || typeof imageId !== "string" || !ctx.imageIds.has(imageId))
      return null;
    return { ...frame, ...box, kind: "image", imageId };
  },
};

/**
 * Validate one object from an untrusted plan.
 *
 * The shared frame (position and rotation) is checked here; the kind's own
 * fields are checked by its entry in {@link SANITIZERS}. Unknown kinds and
 * objects without a usable position are dropped rather than failing the
 * whole save: one broken object should not cost the user every other edit.
 *
 * @param raw Anything.
 * @param ctx Font metrics and the ids of the images sent with the plan.
 * @returns A valid object, or `null` to drop it.
 */
export function sanitizeObject(
  raw: unknown,
  ctx: SanitizeContext,
): EditObject | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  // hasOwn, not `in`: a kind such as "toString" or "__proto__" must not reach
  // an inherited Object.prototype member.
  if (!Object.hasOwn(SANITIZERS, raw.kind)) return null;
  const sanitizer = SANITIZERS[raw.kind as EditObjectKind];
  const x = readCoordinate(raw.x);
  const y = readCoordinate(raw.y);
  if (x === null || y === null) return null;
  const frame: ObjectFrame = {
    id: typeof raw.id === "string" ? raw.id : "",
    x,
    y,
    rotation: isQuarterTurns(raw.rotation) ? raw.rotation : 0,
  };
  return sanitizer(raw, frame, ctx);
}

/**
 * Validate the images sent with a plan. Entries without a usable id, type
 * or bytes are skipped; a repeated id keeps its first entry.
 *
 * @param value Anything.
 * @returns The valid images.
 */
export function sanitizeImages(value: unknown): SaveImage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const images: SaveImage[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const { id, mime, bytes } = raw;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    if (!IMAGE_MIMES.includes(mime as ImageMime)) continue;
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) continue;
    seen.add(id);
    images.push({ id, mime: mime as ImageMime, bytes });
  }
  return images;
}

/** Line ids are object indices joined by "-", such as "3" or "3-4-5". */
const RUN_ID = /^\d+(?:-\d+)*$/;

/**
 * Validate a list of text edits from an untrusted message.
 *
 * Entries need a well-formed line id and string text. The text is put on
 * one line (a PDF text line cannot hold a line break: breaks and tabs become
 * spaces) and cut to {@link MAX_TEXT_LENGTH}. If a line is edited twice, the
 * last edit wins. Characters are not filtered here: which ones can be
 * written depends on the line's original font, which only the engine knows.
 *
 * @param value Anything.
 * @returns The valid edits.
 */
export function sanitizeTextEdits(value: unknown): TextEdit[] {
  if (!Array.isArray(value)) return [];
  const byRun = new Map<string, string>();
  for (const raw of value) {
    if (
      !isRecord(raw) ||
      typeof raw.runId !== "string" ||
      !RUN_ID.test(raw.runId)
    )
      continue;
    if (typeof raw.text !== "string") continue;
    byRun.set(
      raw.runId,
      raw.text.replace(/[\r\n\t]+/g, " ").slice(0, MAX_TEXT_LENGTH),
    );
  }
  return [...byRun].map(([runId, text]) => ({ runId, text }));
}

/**
 * Turn an untrusted save request into a valid {@link SavePlan}.
 *
 * The worker never trusts its input, because a message can carry anything.
 * Two levels of strictness apply:
 * - The page list must be exactly right, or saving fails with
 *   {@link InvalidPlanError}: every entry needs a whole-number source index
 *   within the file, with no repeats, and at least one page must remain.
 *   Guessing here could silently delete or duplicate pages.
 * - Objects, images and text edits are cleaned up individually (see
 *   {@link sanitizeObject} and {@link sanitizeTextEdits}): numbers are
 *   clamped, unwritable characters are removed and unusable entries are
 *   dropped.
 *
 * @param raw The request's plan.
 * @param pageCount Number of pages in the opened file.
 * @param metrics Font metrics, to remove characters the fonts cannot write.
 * @returns A plan the engine can apply as-is.
 * @throws {InvalidPlanError} When the page list is unusable.
 */
export function sanitizeSavePlan(
  raw: unknown,
  pageCount: number,
  metrics: FontMetricsSource,
): SavePlan {
  if (!isRecord(raw) || !Array.isArray(raw.pages)) {
    throw new InvalidPlanError("The edit plan has no page list.");
  }
  if (raw.pages.length === 0) {
    throw new InvalidPlanError("A PDF needs at least one page.");
  }
  const images = sanitizeImages(raw.images);
  const ctx: SanitizeContext = {
    metrics,
    imageIds: new Set(images.map((i) => i.id)),
  };
  const seen = new Set<number>();
  const pages: SavePage[] = raw.pages.map((page) => {
    const source = isRecord(page) ? page.sourceIndex : undefined;
    if (
      typeof source !== "number" ||
      !Number.isInteger(source) ||
      source < 0 ||
      source >= pageCount ||
      seen.has(source)
    ) {
      throw new InvalidPlanError(
        "The edit plan lists a page that does not exist.",
      );
    }
    seen.add(source);
    const p = page as Record<string, unknown>;
    const objects = Array.isArray(p.objects)
      ? p.objects
          .map((o) => sanitizeObject(o, ctx))
          .filter((o): o is EditObject => o !== null)
      : [];
    return {
      sourceIndex: source,
      rotation: isQuarterTurns(p.rotation) ? p.rotation : 0,
      objects,
      textEdits: sanitizeTextEdits(p.textEdits),
    };
  });
  return { pages, images };
}
