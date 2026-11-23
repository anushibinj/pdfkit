import type { PageInfo } from "@/lib/pdfium/pdfium-document";
import {
  cropRectForPage,
  validateMargins,
  type Margins,
  type UserRect,
} from "./margins";

/** One page to crop, and the area of it to keep in user space. */
export interface PageCropRequest {
  /** 0-based page index. */
  pageIndex: number;
  rect: UserRect;
}

/** What to crop. Plain data, so it can be posted to the worker. */
export interface CropPlan {
  /** Delete the content outside the crop area instead of only hiding it. */
  removeOutside: boolean;
  pages: PageCropRequest[];
}

/** A plan, or the first page the margins do not fit. */
export type BuildPlanResult =
  | { ok: true; plan: CropPlan }
  | { ok: false; pageIndex: number; message: string };

/** The plan was malformed when it reached the worker. */
export class InvalidCropPlanError extends Error {
  /** @param message What is wrong with it. */
  constructor(message: string) {
    super(message);
    this.name = "InvalidCropPlanError";
  }
}

/** Wire format version of the pdf-crop module (`crates/pdf-crop/src/plan.rs`). */
export const PLAN_VERSION = 1;
/** Wire format flag: remove what is outside. */
export const FLAG_REMOVE_OUTSIDE = 1;

/**
 * Work out the crop rectangle of every selected page.
 *
 * The same margins are applied to each page's own displayed edges, so
 * pages of different sizes or rotations are each cropped by the same
 * amount on each side.
 *
 * @param pages Every page's box and rotation, by page index.
 * @param selection 0-based indices of the pages to crop.
 * @param margins What to cut from each displayed edge, in points.
 * @param removeOutside Whether to delete what lies outside.
 * @returns The plan, or the first page where the margins leave too little
 *   (or that does not exist).
 */
export function buildCropPlan(
  pages: readonly PageInfo[],
  selection: readonly number[],
  margins: Margins,
  removeOutside: boolean,
): BuildPlanResult {
  if (selection.length === 0) {
    return { ok: false, pageIndex: -1, message: "No pages are selected." };
  }
  const invalid = validateMargins(margins);
  if (invalid) {
    return { ok: false, pageIndex: -1, message: invalid.message };
  }
  const requests: PageCropRequest[] = [];
  for (const pageIndex of selection) {
    const info = pages[pageIndex];
    if (!info) {
      return {
        ok: false,
        pageIndex,
        message: `There is no page ${pageIndex + 1}.`,
      };
    }
    const rect = cropRectForPage(info.box, info.rotation, margins);
    if (!rect) {
      return {
        ok: false,
        pageIndex,
        message: `The margins leave nothing to keep on page ${pageIndex + 1}.`,
      };
    }
    requests.push({ pageIndex, rect });
  }
  return { ok: true, plan: { removeOutside, pages: requests } };
}

/**
 * The plan in the pdf-crop module's wire format: little-endian 64-bit
 * floats `[version, flags, count, (pageIndex, left, bottom, right, top)...]`.
 *
 * A `DataView` writes explicitly little-endian (a `Float64Array` would use
 * the platform's byte order, which only happens to be little-endian).
 *
 * @param plan A plan (see {@link sanitizeCropPlan} for untrusted ones).
 * @returns The bytes.
 */
export function encodeCropPlan(plan: CropPlan): Uint8Array {
  const numbers = [
    PLAN_VERSION,
    plan.removeOutside ? FLAG_REMOVE_OUTSIDE : 0,
    plan.pages.length,
    ...plan.pages.flatMap(({ pageIndex, rect }) => [
      pageIndex,
      rect.left,
      rect.bottom,
      rect.right,
      rect.top,
    ]),
  ];
  const bytes = new Uint8Array(numbers.length * 8);
  const view = new DataView(bytes.buffer);
  numbers.forEach((n, i) => view.setFloat64(i * 8, n, true));
  return bytes;
}

/**
 * Check a plan that crossed a thread boundary (it could be anything).
 *
 * The pdf-crop module validates the numbers again; this check exists so
 * that a malformed plan gets a clear message instead of a crash, and only
 * known fields reach the module.
 *
 * @param raw The posted value.
 * @param pageCount Pages in the open document.
 * @returns A well-formed plan.
 * @throws {InvalidCropPlanError} Describing the first problem.
 */
export function sanitizeCropPlan(raw: unknown, pageCount: number): CropPlan {
  if (!isRecord(raw) || !Array.isArray(raw.pages)) {
    throw new InvalidCropPlanError("the plan has no pages");
  }
  if (raw.pages.length === 0) {
    throw new InvalidCropPlanError("the plan has no pages");
  }
  const seen = new Set<number>();
  const pages = raw.pages.map((entry: unknown): PageCropRequest => {
    if (!isRecord(entry) || !isRecord(entry.rect)) {
      throw new InvalidCropPlanError("a page entry is malformed");
    }
    const { pageIndex, rect } = entry;
    if (
      typeof pageIndex !== "number" ||
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= pageCount ||
      seen.has(pageIndex)
    ) {
      throw new InvalidCropPlanError("a page index is invalid or repeated");
    }
    seen.add(pageIndex);
    const sides = [rect.left, rect.bottom, rect.right, rect.top];
    if (!sides.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new InvalidCropPlanError(
        `the crop of page ${pageIndex + 1} is invalid`,
      );
    }
    const [left, bottom, right, top] = sides as number[];
    if (right <= left || top <= bottom) {
      throw new InvalidCropPlanError(
        `the crop of page ${pageIndex + 1} is empty`,
      );
    }
    return { pageIndex, rect: { left, bottom, right, top } };
  });
  return { removeOutside: raw.removeOutside === true, pages };
}

/**
 * True for plain objects (not `null`, not arrays).
 *
 * @param value Anything.
 * @returns Whether its fields can be read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
