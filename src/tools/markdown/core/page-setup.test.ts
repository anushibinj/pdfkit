import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SETUP,
  MARGIN_LIMITS_MM,
  PAGE_SIZES,
  isPageSizeName,
  mmToPoints,
  normalizePageSetup,
} from "./page-setup";

describe("mmToPoints", () => {
  it("converts using 72 points per inch", () => {
    expect(mmToPoints(25.4)).toBeCloseTo(72);
    expect(mmToPoints(0)).toBe(0);
    expect(mmToPoints(20)).toBeCloseTo(56.693, 3);
  });
});

describe("isPageSizeName", () => {
  it.each(PAGE_SIZES)("accepts %s", (size) => {
    expect(isPageSizeName(size)).toBe(true);
  });

  it.each(["a4", "A3", "", 4, null, undefined])("rejects %j", (value) => {
    expect(isPageSizeName(value)).toBe(false);
  });
});

describe("normalizePageSetup", () => {
  it("keeps valid settings", () => {
    expect(normalizePageSetup({ size: "Letter", marginMm: 12.5 })).toEqual({
      size: "Letter",
      marginMm: 12.5,
    });
  });

  it("fills in defaults for missing or invalid values", () => {
    expect(normalizePageSetup(undefined)).toEqual(DEFAULT_PAGE_SETUP);
    expect(
      normalizePageSetup({ size: "A0" as never, marginMm: Number.NaN }),
    ).toEqual(DEFAULT_PAGE_SETUP);
    expect(normalizePageSetup({ marginMm: "10" as never }).marginMm).toBe(
      DEFAULT_PAGE_SETUP.marginMm,
    );
  });

  it("clamps margins into the allowed range", () => {
    expect(normalizePageSetup({ marginMm: -5 }).marginMm).toBe(
      MARGIN_LIMITS_MM.min,
    );
    expect(normalizePageSetup({ marginMm: 500 }).marginMm).toBe(
      MARGIN_LIMITS_MM.max,
    );
  });
});
