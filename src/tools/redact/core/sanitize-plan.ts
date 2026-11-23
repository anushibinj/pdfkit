import type { PageBox } from "@/lib/pdfium/page-box";
import {
  DEFAULT_CLEANUP_OPTIONS,
  DEFAULT_MARK_STYLE,
  type CleanupOptions,
  type RedactionMark,
  type RedactionMarkStyle,
  type RedactionPlan,
  type RedactionSource,
} from "./model";

const VALID_SOURCES: ReadonlySet<RedactionSource> = new Set([
  "manual",
  "text",
  "regex",
  "email",
  "phone",
  "pan",
  "aadhaar",
  "ifsc",
  "card",
  "date",
]);

/** Error thrown when an untrusted redaction plan fails validation. */
export class InvalidRedactionPlanError extends Error {
  /** @param message Description of what in the plan is invalid. */
  constructor(message: string) {
    super(message);
    this.name = "InvalidRedactionPlanError";
  }
}

/**
 * Validate and normalise a `PageBox` from untrusted input.
 *
 * @param raw Candidate box object.
 * @returns Normalised `{ left, bottom, right, top }`.
 * @throws {InvalidRedactionPlanError} When any coordinate is missing, non-finite, or empty.
 */
export function sanitizeBox(raw: unknown): PageBox {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidRedactionPlanError("redaction box must be an object");
  }
  const b = raw as Record<string, unknown>;
  const coords = [b.left, b.bottom, b.right, b.top];
  if (!coords.every((c) => typeof c === "number" && Number.isFinite(c))) {
    throw new InvalidRedactionPlanError(
      "redaction box coordinates must be finite numbers",
    );
  }
  const [l, bot, r, t] = coords as number[];
  const left = Math.min(l, r);
  const right = Math.max(l, r);
  const bottom = Math.min(bot, t);
  const top = Math.max(bot, t);
  if (right - left <= 0 || top - bottom <= 0) {
    throw new InvalidRedactionPlanError("redaction box has no area");
  }
  return { left, bottom, right, top };
}

/**
 * Validate and normalise one {@link RedactionMark}.
 *
 * @param raw Untrusted mark value.
 * @param pageCount Total page count of the opened document.
 * @returns Sanitised mark.
 */
export function sanitizeMark(raw: unknown, pageCount: number): RedactionMark {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidRedactionPlanError("redaction mark must be an object");
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.length === 0) {
    throw new InvalidRedactionPlanError("mark id must be a non-empty string");
  }
  if (
    typeof m.pageIndex !== "number" ||
    !Number.isInteger(m.pageIndex) ||
    m.pageIndex < 0 ||
    m.pageIndex >= pageCount
  ) {
    throw new InvalidRedactionPlanError("mark pageIndex is out of range");
  }
  const source: RedactionSource =
    typeof m.source === "string" &&
    VALID_SOURCES.has(m.source as RedactionSource)
      ? (m.source as RedactionSource)
      : "manual";
  return {
    id: m.id,
    pageIndex: m.pageIndex,
    box: sanitizeBox(m.box),
    term: typeof m.term === "string" ? m.term : "",
    source,
    label: typeof m.label === "string" ? m.label : "Area",
    enabled: m.enabled !== false,
  };
}

/**
 * Validate and normalise mark visual style.
 *
 * @param raw Untrusted style object.
 * @returns Sanitised style.
 */
export function sanitizeStyle(raw: unknown): RedactionMarkStyle {
  if (typeof raw !== "object" || raw === null) return DEFAULT_MARK_STYLE;
  const s = raw as Record<string, unknown>;
  const fill = s.fill === "white" ? "white" : "black";
  const label =
    typeof s.label === "string" ? s.label.trim().slice(0, 48) : "";
  return { fill, label };
}

/**
 * Validate and normalise document-wide cleanup flags.
 *
 * @param raw Untrusted cleanup object.
 * @returns Sanitised cleanup options.
 */
export function sanitizeCleanupOptions(raw: unknown): CleanupOptions {
  if (typeof raw !== "object" || raw === null) return DEFAULT_CLEANUP_OPTIONS;
  const c = raw as Record<string, unknown>;
  return {
    metadata: typeof c.metadata === "boolean" ? c.metadata : true,
    attachments: typeof c.attachments === "boolean" ? c.attachments : true,
    javascript: typeof c.javascript === "boolean" ? c.javascript : true,
    hiddenLayers: typeof c.hiddenLayers === "boolean" ? c.hiddenLayers : true,
    bookmarks: typeof c.bookmarks === "boolean" ? c.bookmarks : true,
  };
}

/**
 * Validate and normalise an untrusted {@link RedactionPlan} crossing the worker boundary.
 *
 * @param raw Untrusted plan payload.
 * @param pageCount Total page count of the opened document.
 * @returns Sanitised plan ready for execution.
 * @throws {InvalidRedactionPlanError} When the plan is invalid or has no enabled marks.
 */
export function sanitizeRedactionPlan(
  raw: unknown,
  pageCount: number,
): RedactionPlan {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidRedactionPlanError("plan must be an object");
  }
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.marks)) {
    throw new InvalidRedactionPlanError("marks must be an array");
  }
  const marks = p.marks.map((mark) => sanitizeMark(mark, pageCount));
  if (!marks.some((m) => m.enabled)) {
    throw new InvalidRedactionPlanError(
      "select at least one redaction mark to apply",
    );
  }
  return {
    marks,
    style: sanitizeStyle(p.style),
    cleanup: sanitizeCleanupOptions(p.cleanup),
    rasterizePages: p.rasterizePages === true,
  };
}

/**
 * Encode the sanitization parameters into the binary wire format expected by
 * `crates/pdf-redact/src/plan.rs` (`PLAN_VERSION = 1`).
 *
 * @param cleanup Document-wide cleanup flags.
 * @param replacementLabel Label used to scrub leaked terms in bookmarks/structure.
 * @param terms Unique non-empty redacted terms.
 * @param boxes Enabled redaction boxes across pages.
 * @returns Little-endian binary plan buffer.
 */
export function encodeSanitizePlan(
  cleanup: CleanupOptions,
  replacementLabel: string,
  terms: readonly string[],
  boxes: readonly { pageIndex: number; box: PageBox }[],
): Uint8Array {
  const encoder = new TextEncoder();
  const labelBytes = encoder.encode(
    replacementLabel.trim().length > 0 ? replacementLabel.trim() : "[REDACTED]",
  );
  const termBytes = terms
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => encoder.encode(t));

  const totalBytes =
    4 + // version
    4 + // flags
    4 +
    labelBytes.length +
    4 + // term_count
    termBytes.reduce((acc, b) => acc + 4 + b.length, 0) +
    4 + // box_count
    boxes.length * (4 + 8 * 4);

  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  const writeU32 = (v: number) => {
    view.setUint32(offset, v >>> 0, true);
    offset += 4;
  };
  const writeF64 = (v: number) => {
    view.setFloat64(offset, v, true);
    offset += 8;
  };
  const writeStr = (b: Uint8Array) => {
    writeU32(b.length);
    bytes.set(b, offset);
    offset += b.length;
  };

  let flags = 0;
  if (cleanup.metadata) flags |= 1 << 0;
  if (cleanup.attachments) flags |= 1 << 1;
  if (cleanup.javascript) flags |= 1 << 2;
  if (cleanup.hiddenLayers) flags |= 1 << 3;
  if (cleanup.bookmarks) flags |= 1 << 4;

  writeU32(1); // PLAN_VERSION
  writeU32(flags);
  writeStr(labelBytes);
  writeU32(termBytes.length);
  for (const t of termBytes) writeStr(t);
  writeU32(boxes.length);
  for (const { pageIndex, box } of boxes) {
    writeU32(pageIndex);
    writeF64(box.left);
    writeF64(box.bottom);
    writeF64(box.right);
    writeF64(box.top);
  }

  return bytes;
}
