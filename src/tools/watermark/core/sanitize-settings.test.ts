// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GREEN_JPEG, makePng } from "@/lib/test-utils/images";
import { DEFAULT_SETTINGS, MAX_TEXT_LENGTH } from "./model";
import {
  InvalidSettingsError,
  clampNumber,
  normalizeRotation,
  sanitizeImageContent,
  sanitizePageIndices,
  sanitizeSettings,
  sanitizeTextContent,
} from "./sanitize-settings";

const buffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
const PNG = buffer(makePng(4, 2, () => [255, 0, 0, 255]));

describe("clampNumber", () => {
  it("clamps numbers and falls back for anything else", () => {
    const limits = { min: 1, max: 10 };
    expect(clampNumber(5, limits, 3)).toBe(5);
    expect(clampNumber(-2, limits, 3)).toBe(1);
    expect(clampNumber(99, limits, 3)).toBe(10);
    for (const bad of [Number.NaN, Infinity, "5", undefined, null])
      expect(clampNumber(bad, limits, 3)).toBe(3);
  });
});

describe("normalizeRotation", () => {
  it.each([
    [45, 45],
    [-45, -45],
    [270, -90],
    [-270, 90],
    [360, 0],
    [180, -180],
    [725, 5],
  ])("%d -> %d", (input, expected) => {
    expect(normalizeRotation(input, 0)).toBeCloseTo(expected, 9);
  });

  it("falls back for non-numbers", () => {
    expect(normalizeRotation("45", 30)).toBe(30);
    expect(normalizeRotation(Number.NaN, 30)).toBe(30);
  });
});

describe("sanitizeTextContent", () => {
  it("normalises the text and fills in defaults", () => {
    expect(
      sanitizeTextContent({
        kind: "text",
        text: " DRAFT \r\n",
        fontSize: 9999,
      }),
    ).toEqual({
      kind: "text",
      text: " DRAFT",
      font: "helvetica",
      bold: false,
      fontSize: 400,
      color: { r: 128, g: 128, b: 128 },
    });
  });

  it("keeps valid choices and clamps colour channels", () => {
    expect(
      sanitizeTextContent({
        kind: "text",
        text: "A",
        font: "courier",
        bold: true,
        fontSize: 12,
        color: { r: 300, g: -1, b: 12.6 },
      }),
    ).toMatchObject({
      font: "courier",
      bold: true,
      fontSize: 12,
      color: { r: 255, g: 0, b: 13 },
    });
  });

  it.each([
    [{ text: "  \n " }, /Type the watermark text/],
    [{ text: 42 }, /Type the watermark text/],
    [{ text: "x".repeat(MAX_TEXT_LENGTH + 1) }, /too long/],
    [
      { text: Array.from({ length: 11 }, () => "a").join("\n") },
      /too many lines/,
    ],
    [{ text: "Price ₹ 5 👍" }, /standard PDF fonts: ₹ 👍/],
  ])("refuses %j", (raw, message) => {
    expect(() => sanitizeTextContent({ kind: "text", ...raw })).toThrow(
      message,
    );
    expect(() => sanitizeTextContent({ kind: "text", ...raw })).toThrow(
      InvalidSettingsError,
    );
  });
});

describe("sanitizeImageContent", () => {
  it("identifies a PNG and reads its size from the bytes", () => {
    const spec = sanitizeImageContent({
      kind: "image",
      bytes: PNG,
      scale: 0.5,
    });
    expect(spec).toMatchObject({
      kind: "image",
      mime: "image/png",
      pixelWidth: 4,
      pixelHeight: 2,
      scale: 0.5,
    });
    expect(spec.bytes.byteLength).toBe(PNG.byteLength);
  });

  it("identifies a JPEG and clamps the scale", () => {
    expect(
      sanitizeImageContent({
        kind: "image",
        bytes: buffer(GREEN_JPEG),
        scale: 7,
      }),
    ).toMatchObject({ mime: "image/jpeg", scale: 1 });
  });

  it.each([
    [undefined, /Choose a picture/],
    [new ArrayBuffer(0), /Choose a picture/],
    [buffer(new TextEncoder().encode("GIF89a....")), /not a PNG or JPEG/],
  ])("refuses %#", (bytes, message) => {
    expect(() => sanitizeImageContent({ kind: "image", bytes })).toThrow(
      message,
    );
  });

  it("refuses pictures over the size limit", () => {
    expect(() =>
      sanitizeImageContent({
        kind: "image",
        bytes: new ArrayBuffer(21 * 1024 * 1024),
      }),
    ).toThrow(/larger than 20 MB/);
  });
});

describe("sanitizeSettings", () => {
  it("passes valid settings through", () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual({
      ...DEFAULT_SETTINGS,
      content: { ...DEFAULT_SETTINGS.content },
    });
  });

  it("replaces unknown choices and out-of-range numbers", () => {
    expect(
      sanitizeSettings({
        content: { kind: "text", text: "A" },
        opacity: 5,
        rotation: 270,
        position: "middle",
        layer: "sideways",
      }),
    ).toMatchObject({
      opacity: 1,
      rotation: -90,
      position: "center",
      layer: "over",
    });
  });

  it("keeps tile and under", () => {
    expect(
      sanitizeSettings({
        ...DEFAULT_SETTINGS,
        position: "tile",
        layer: "under",
      }),
    ).toMatchObject({ position: "tile", layer: "under" });
  });

  it.each([null, "x", {}, { content: { kind: "video" } }])(
    "refuses %j",
    (raw) => {
      expect(() => sanitizeSettings(raw)).toThrow(InvalidSettingsError);
    },
  );
});

describe("sanitizePageIndices", () => {
  it("drops duplicates and sorts", () => {
    expect(sanitizePageIndices([2, 0, 2, 1], 3)).toEqual([0, 1, 2]);
  });

  it.each([[undefined], [[]], [[3]], [[-1]], [[0.5]], [["0"]]])(
    "refuses %j",
    (raw) => {
      expect(() => sanitizePageIndices(raw, 3)).toThrow(InvalidSettingsError);
    },
  );
});
