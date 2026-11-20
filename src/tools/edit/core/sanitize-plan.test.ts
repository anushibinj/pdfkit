import { describe, expect, it } from "vitest";
import { fakeMetrics } from "../test-utils/fake-metrics";
import {
  FONT_SIZE_LIMITS,
  MAX_COORDINATE,
  MAX_TEXT_LENGTH,
  MAX_INK_POINTS,
  STROKE_WIDTH_LIMITS,
} from "./model";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_WIDTH,
  InvalidPlanError,
  isRecord,
  readClamped,
  readColor,
  readCoordinate,
  readPoints,
  readSize,
  sanitizeImages,
  sanitizeObject,
  sanitizeSavePlan,
  sanitizeTextEdits,
} from "./sanitize-plan";

const ctx = { metrics: fakeMetrics, imageIds: new Set(["img"]) };
const frame = { id: "a", x: 10, y: 20, rotation: 1 };
const png = () => ({ id: "img", mime: "image/png", bytes: new ArrayBuffer(3) });

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("readCoordinate", () => {
  it("accepts finite numbers within range", () => {
    expect(readCoordinate(-12.5)).toBe(-12.5);
    expect(readCoordinate(MAX_COORDINATE)).toBe(MAX_COORDINATE);
  });
  it.each([Number.NaN, Infinity, MAX_COORDINATE + 1, "5", null])(
    "rejects %j",
    (v) => {
      expect(readCoordinate(v)).toBeNull();
    },
  );
});

describe("readSize", () => {
  it("accepts positive finite sizes", () => {
    expect(readSize(0.5)).toBe(0.5);
  });
  it.each([0, -1, Number.NaN, 3 * MAX_COORDINATE, "4"])("rejects %j", (v) => {
    expect(readSize(v)).toBeNull();
  });
});

describe("readClamped", () => {
  it("clamps into the range and falls back for non-numbers", () => {
    expect(readClamped(500, FONT_SIZE_LIMITS, 14)).toBe(FONT_SIZE_LIMITS.max);
    expect(readClamped(1, FONT_SIZE_LIMITS, 14)).toBe(FONT_SIZE_LIMITS.min);
    expect(readClamped(20, FONT_SIZE_LIMITS, 14)).toBe(20);
    expect(readClamped(Number.NaN, FONT_SIZE_LIMITS, 14)).toBe(14);
    expect(readClamped("20", FONT_SIZE_LIMITS, 14)).toBe(14);
  });
});

describe("readColor", () => {
  it("clamps channels and falls back for non-objects", () => {
    const fallback = { r: 1, g: 2, b: 3 };
    expect(readColor({ r: 300, g: -5, b: 12.6 }, fallback)).toEqual({
      r: 255,
      g: 0,
      b: 13,
    });
    expect(readColor("red", fallback)).toBe(fallback);
  });
});

describe("readPoints", () => {
  it("keeps valid points and skips the rest", () => {
    expect(
      readPoints([
        { x: 1, y: 2 },
        { x: "1", y: 2 },
        null,
        { x: 3, y: Infinity },
      ]),
    ).toEqual([{ x: 1, y: 2 }]);
    expect(readPoints("nope")).toEqual([]);
  });

  it("keeps at most MAX_INK_POINTS", () => {
    const many = Array.from({ length: MAX_INK_POINTS + 5 }, (_, i) => ({
      x: i,
      y: 0,
    }));
    expect(readPoints(many)).toHaveLength(MAX_INK_POINTS);
  });
});

describe("sanitizeObject", () => {
  it("keeps a valid text object and strips unwritable characters", () => {
    expect(
      sanitizeObject(
        {
          ...frame,
          kind: "text",
          text: "Pay ₹5\r\nnow",
          font: "serif",
          fontSize: 12,
          color: { r: 1, g: 2, b: 3 },
        },
        ctx,
      ),
    ).toEqual({
      ...frame,
      kind: "text",
      text: "Pay 5\nnow",
      font: "serif",
      fontSize: 12,
      color: { r: 1, g: 2, b: 3 },
    });
  });

  it("defaults the font, size and colour of text", () => {
    expect(
      sanitizeObject({ ...frame, kind: "text", text: "x", font: "comic" }, ctx),
    ).toMatchObject({
      font: "sans",
      fontSize: DEFAULT_FONT_SIZE,
      color: { r: 0, g: 0, b: 0 },
    });
  });

  it("drops text that is empty after cleaning", () => {
    expect(
      sanitizeObject({ ...frame, kind: "text", text: " ₹ " }, ctx),
    ).toBeNull();
  });

  it("keeps ink with valid points and clamps the width", () => {
    expect(
      sanitizeObject(
        { ...frame, kind: "ink", points: [{ x: 0, y: 0 }], strokeWidth: 999 },
        ctx,
      ),
    ).toMatchObject({ kind: "ink", strokeWidth: STROKE_WIDTH_LIMITS.max });
    expect(
      sanitizeObject({ ...frame, kind: "ink", points: [] }, ctx),
    ).toBeNull();
  });

  it("keeps boxes with a usable size", () => {
    expect(
      sanitizeObject({ ...frame, kind: "rect", width: 5, height: 6 }, ctx),
    ).toMatchObject({
      kind: "rect",
      width: 5,
      height: 6,
      strokeWidth: DEFAULT_STROKE_WIDTH,
    });
    expect(
      sanitizeObject({ ...frame, kind: "highlight", width: 5, height: 6 }, ctx),
    ).toMatchObject({
      kind: "highlight",
    });
    expect(
      sanitizeObject({ ...frame, kind: "highlight", width: 0, height: 6 }, ctx),
    ).toBeNull();
    // White-out no longer exists: old plans that still carry it are dropped.
    expect(
      sanitizeObject({ ...frame, kind: "whiteout", width: 5, height: 6 }, ctx),
    ).toBeNull();
  });

  it("keeps images only when their bytes were sent", () => {
    const image = { ...frame, kind: "image", width: 5, height: 5 };
    expect(sanitizeObject({ ...image, imageId: "img" }, ctx)).toMatchObject({
      imageId: "img",
    });
    expect(sanitizeObject({ ...image, imageId: "other" }, ctx)).toBeNull();
  });

  it("normalises the frame", () => {
    expect(
      sanitizeObject(
        { kind: "rect", x: 1, y: 2, rotation: 7, width: 1, height: 1 },
        ctx,
      ),
    ).toMatchObject({ id: "", rotation: 0 });
  });

  it.each([
    null,
    { kind: "circle", x: 0, y: 0 },
    { kind: "toString", x: 0, y: 0 },
    { kind: "rect", x: Number.NaN, y: 0, width: 1, height: 1 },
  ])("drops %j", (raw) => {
    expect(sanitizeObject(raw, ctx)).toBeNull();
  });
});

describe("sanitizeImages", () => {
  it("keeps valid images once", () => {
    const a = png();
    expect(sanitizeImages([a, { ...png() }])).toEqual([a]);
  });

  it.each([
    [{ ...png(), mime: "image/gif" }],
    [{ ...png(), id: "" }],
    [{ ...png(), bytes: new ArrayBuffer(0) }],
    [{ ...png(), bytes: "abc" }],
    [null],
  ])("skips %j", (raw) => {
    expect(sanitizeImages([raw])).toEqual([]);
  });

  it("treats a missing list as no images", () => {
    expect(sanitizeImages(undefined)).toEqual([]);
  });
});

describe("sanitizeTextEdits", () => {
  it("keeps well-formed edits on one line, the last edit per line winning", () => {
    expect(
      sanitizeTextEdits([
        { runId: "3-4", text: "Total\r\n1520\tdollars" },
        { runId: "7", text: "old" },
        { runId: "7", text: "" },
      ]),
    ).toEqual([
      { runId: "3-4", text: "Total 1520 dollars" },
      { runId: "7", text: "" },
    ]);
  });

  it("keeps characters the engine may still be able to write", () => {
    // Filtering is font-specific, so it happens in the engine.
    expect(sanitizeTextEdits([{ runId: "1", text: "₹ 500" }])).toEqual([
      { runId: "1", text: "₹ 500" },
    ]);
  });

  it.each([
    [[{ runId: "a", text: "x" }]],
    [[{ runId: "1-", text: "x" }]],
    [[{ runId: "1", text: 5 }]],
    [[null]],
    ["nope"],
  ])("drops %j", (raw) => {
    expect(sanitizeTextEdits(raw)).toEqual([]);
  });

  it("cuts very long text", () => {
    const [edit] = sanitizeTextEdits([
      { runId: "1", text: "x".repeat(MAX_TEXT_LENGTH + 9) },
    ]);
    expect(edit.text).toHaveLength(MAX_TEXT_LENGTH);
  });
});

describe("sanitizeSavePlan", () => {
  it("returns a clean plan", () => {
    const image = png();
    const plan = sanitizeSavePlan(
      {
        pages: [
          {
            sourceIndex: 1,
            rotation: 2,
            objects: [
              { ...frame, kind: "image", imageId: "img", width: 1, height: 1 },
              { kind: "bad" },
            ],
            textEdits: [{ runId: "2-3", text: "New" }, { runId: "x" }],
          },
          { sourceIndex: 0, rotation: "x", objects: "nope" },
        ],
        images: [image],
      },
      2,
      fakeMetrics,
    );
    expect(plan.pages).toEqual([
      {
        sourceIndex: 1,
        rotation: 2,
        objects: [
          { ...frame, kind: "image", imageId: "img", width: 1, height: 1 },
        ],
        textEdits: [{ runId: "2-3", text: "New" }],
      },
      { sourceIndex: 0, rotation: 0, objects: [], textEdits: [] },
    ]);
    expect(plan.images).toEqual([image]);
  });

  it.each([
    [null, "no page list"],
    [{ pages: [] }, "at least one page"],
    [{ pages: [{ sourceIndex: 2 }] }, "does not exist"],
    [{ pages: [{ sourceIndex: 0 }, { sourceIndex: 0 }] }, "does not exist"],
    [{ pages: [{ sourceIndex: 0.5 }] }, "does not exist"],
    [{ pages: [null] }, "does not exist"],
  ])("rejects the unusable plan %j", (raw, message) => {
    expect(() => sanitizeSavePlan(raw, 2, fakeMetrics)).toThrow(
      InvalidPlanError,
    );
    expect(() => sanitizeSavePlan(raw, 2, fakeMetrics)).toThrow(message);
  });
});
