import { describe, expect, it } from "vitest";
import {
  STANDARD_FONT_NAME,
  StandardFontMetricsSource,
  loadStandardFontMetrics,
} from "./standard-font-metrics";

describe("STANDARD_FONT_NAME", () => {
  it("maps families to standard 14 font names", () => {
    expect(STANDARD_FONT_NAME).toEqual({
      sans: "Helvetica",
      serif: "Times-Roman",
      mono: "Courier",
    });
  });
});

describe("loadStandardFontMetrics", () => {
  it("reads Adobe's published Helvetica metrics", () => {
    const helvetica = loadStandardFontMetrics("Helvetica");
    expect(helvetica.ascent).toBe(718);
    expect(helvetica.descent).toBe(-207);
    expect(helvetica.advance("A")).toBe(667);
    expect(helvetica.advance(" ")).toBe(278);
  });

  it("gives every Courier glyph the same width", () => {
    const courier = loadStandardFontMetrics("Courier");
    expect(courier.advance("i")).toBe(600);
    expect(courier.advance("W")).toBe(600);
  });

  it.each(["é", "€", "“", "–", "…", "•", " "])(
    "can write the WinAnsi character %j",
    (char) => {
      expect(
        loadStandardFontMetrics("Times-Roman").advance(char),
      ).toBeGreaterThan(0);
    },
  );

  it.each(["₹", "न", "中", "Ω", "😀", "\n", "\t"])(
    "cannot write %j",
    (char) => {
      expect(
        loadStandardFontMetrics("Helvetica").advance(char),
      ).toBeUndefined();
    },
  );
});

describe("StandardFontMetricsSource", () => {
  it("returns the family's font and caches it", () => {
    const source = new StandardFontMetricsSource();
    const serif = source.metrics("serif");
    expect(serif.ascent).toBe(683); // Times-Roman
    expect(source.metrics("serif")).toBe(serif);
    expect(source.metrics("mono").advance("x")).toBe(600);
  });
});
