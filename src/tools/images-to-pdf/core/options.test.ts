import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT_OPTIONS,
  IMAGE_MARGIN_LIMITS_MM,
  isImagePageSize,
  isImageScaleMode,
  isPageOrientation,
  normalizeLayoutOptions,
} from "./options";

describe("images-to-pdf options", () => {
  describe("isImagePageSize", () => {
    it("accepts supported paper sizes and rejects others", () => {
      expect(isImagePageSize("fit")).toBe(true);
      expect(isImagePageSize("A4")).toBe(true);
      expect(isImagePageSize("Letter")).toBe(true);
      expect(isImagePageSize("Legal")).toBe(true);
      expect(isImagePageSize("A3")).toBe(false);
      expect(isImagePageSize(42)).toBe(false);
    });
  });

  describe("isPageOrientation", () => {
    it("accepts supported orientations and rejects others", () => {
      expect(isPageOrientation("auto")).toBe(true);
      expect(isPageOrientation("portrait")).toBe(true);
      expect(isPageOrientation("landscape")).toBe(true);
      expect(isPageOrientation("diagonal")).toBe(false);
      expect(isPageOrientation(null)).toBe(false);
    });
  });

  describe("isImageScaleMode", () => {
    it("accepts supported scaling modes and rejects others", () => {
      expect(isImageScaleMode("contain")).toBe(true);
      expect(isImageScaleMode("actual")).toBe(true);
      expect(isImageScaleMode("stretch")).toBe(false);
      expect(isImageScaleMode(undefined)).toBe(false);
    });
  });

  describe("normalizeLayoutOptions", () => {
    it("returns defaults when input is undefined", () => {
      expect(normalizeLayoutOptions(undefined)).toEqual(DEFAULT_LAYOUT_OPTIONS);
    });

    it("preserves valid values", () => {
      expect(
        normalizeLayoutOptions({
          pageSize: "Letter",
          orientation: "landscape",
          marginMm: 15,
          scaleMode: "actual",
        }),
      ).toEqual({
        pageSize: "Letter",
        orientation: "landscape",
        marginMm: 15,
        scaleMode: "actual",
      });
    });

    it("falls back to defaults on invalid enums and non-finite margins", () => {
      expect(
        normalizeLayoutOptions({
          pageSize: "Tabloid" as never,
          orientation: "sideways" as never,
          marginMm: Number.NaN,
          scaleMode: "cover" as never,
        }),
      ).toEqual(DEFAULT_LAYOUT_OPTIONS);

      expect(
        normalizeLayoutOptions({ marginMm: Number.POSITIVE_INFINITY }).marginMm,
      ).toBe(DEFAULT_LAYOUT_OPTIONS.marginMm);
    });

    it("clamps finite margins into IMAGE_MARGIN_LIMITS_MM", () => {
      expect(normalizeLayoutOptions({ marginMm: -10 }).marginMm).toBe(
        IMAGE_MARGIN_LIMITS_MM.min,
      );
      expect(normalizeLayoutOptions({ marginMm: 500 }).marginMm).toBe(
        IMAGE_MARGIN_LIMITS_MM.max,
      );
    });
  });
});
