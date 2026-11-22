import { describe, expect, it } from "vitest";
import { fakeMetrics } from "../test-utils/fake-metrics";
import type { Matrix } from "@/lib/geometry/affine";
import {
  continuesLine,
  describeFontStyle,
  effectiveFontSize,
  groupFragments,
  observedCharacters,
  originalFontCanWrite,
  standardFontFor,
  stripSubsetTag,
  unitFrame,
  type FontDescription,
  type PageChar,
  type TextFragment,
} from "./text-runs";

const sans: FontDescription = {
  baseName: "BAAAAA+DejaVuSans",
  family: "DejaVu Sans",
  flags: 4,
  weight: 225,
  italicAngle: 0,
  embedded: true,
};
const black = { r: 0, g: 0, b: 0 };

/** A fragment shaped like Chrome's output: size 14, 0.75 px-to-pt scale. */
function fragment(
  index: number,
  text: string,
  x: number,
  right: number,
  extra: Partial<TextFragment> = {},
): TextFragment {
  const matrix: Matrix = [0.75, 0, 0, 0.75, x, 148.38];
  return {
    index,
    text,
    fontKey: 1,
    font: sans,
    fontSize: 14,
    matrix,
    bounds: { left: x, bottom: 148.2, right, top: 156.5 },
    color: black,
    renderMode: 0,
    ...extra,
  };
}

describe("stripSubsetTag", () => {
  it("removes the six-letter subset prefix only", () => {
    expect(stripSubsetTag("ABCDEF+Calibri-Bold")).toBe("Calibri-Bold");
    expect(stripSubsetTag("Helvetica")).toBe("Helvetica");
    expect(stripSubsetTag("abcdef+X")).toBe("abcdef+X");
  });
});

describe("effectiveFontSize", () => {
  it("scales the Tf size by the matrix's vertical scale", () => {
    expect(effectiveFontSize(14, [0.75, 0, 0, 0.75, 0, 0])).toBeCloseTo(10.5);
    expect(effectiveFontSize(1, [11, 0, 0, 11, 72, 700])).toBe(11); // Word style
    expect(effectiveFontSize(10, [0, 2, -2, 0, 0, 0])).toBe(20); // rotated
  });
});

describe("describeFontStyle", () => {
  it.each([
    [
      { baseName: "AAAAAA+DejaVuSerif-Bold", family: "DejaVu Serif", flags: 6 },
      { family: "serif", bold: true, italic: false },
    ],
    [
      { baseName: "Helvetica-Oblique", family: "", flags: 0 },
      { family: "sans", bold: false, italic: true },
    ],
    [
      { baseName: "Courier", family: "", flags: 0 },
      { family: "mono", bold: false, italic: false },
    ],
    [
      { baseName: "X", family: "", flags: 1 },
      { family: "mono", bold: false, italic: false },
    ],
    [
      { baseName: "X", family: "", flags: 2 },
      { family: "serif", bold: false, italic: false },
    ],
    [
      { baseName: "MS-SansSerif", family: "", flags: 2 },
      { family: "sans", bold: false, italic: false },
    ],
    [
      { baseName: "Calibri", family: "", flags: 0, weight: 700 },
      { family: "sans", bold: true, italic: false },
    ],
    [
      { baseName: "X", family: "", flags: 1 << 18 },
      { family: "sans", bold: true, italic: false },
    ],
    [
      { baseName: "X", family: "", flags: 64 },
      { family: "sans", bold: false, italic: true },
    ],
    [
      { baseName: "X", family: "", flags: 0, italicAngle: -12 },
      { family: "sans", bold: false, italic: true },
    ],
  ] as const)("%j -> %j", (font, expected) => {
    expect(
      describeFontStyle({
        weight: 400,
        italicAngle: 0,
        embedded: true,
        ...font,
      }),
    ).toEqual(expected);
  });
});

describe("standardFontFor", () => {
  it.each([
    ["sans", false, false, "Helvetica"],
    ["sans", true, false, "Helvetica-Bold"],
    ["sans", false, true, "Helvetica-Oblique"],
    ["sans", true, true, "Helvetica-BoldOblique"],
    ["serif", false, false, "Times-Roman"],
    ["serif", true, false, "Times-Bold"],
    ["serif", false, true, "Times-Italic"],
    ["serif", true, true, "Times-BoldItalic"],
    ["mono", false, false, "Courier"],
    ["mono", true, true, "Courier-BoldOblique"],
  ] as const)("%s bold=%s italic=%s -> %s", (family, bold, italic, name) => {
    expect(standardFontFor({ family, bold, italic })).toBe(name);
  });
});

describe("observedCharacters", () => {
  const ch = (char: string, x: number, extra: Partial<PageChar> = {}) => ({
    char,
    x,
    y: 100,
    fontKey: 1,
    generated: false,
    ...extra,
  });

  it("collects drawn characters per font", () => {
    const out = observedCharacters([
      ch("a", 0),
      ch("b", 5),
      ch("a", 10, { fontKey: 2 }),
    ]);
    expect(out.get(1)).toEqual(new Set(["a", "b"]));
    expect(out.get(2)).toEqual(new Set(["a"]));
  });

  it("skips characters PDFium generated", () => {
    const out = observedCharacters([
      ch("a", 0),
      ch(" ", 5, { generated: true }),
    ]);
    expect(out.get(1)).toEqual(new Set(["a"]));
  });

  it("skips the parts of a ligature, which share one origin", () => {
    // "u" + "fl" ligature + "y", as PDFium reports Chromium's output
    const out = observedCharacters([
      ch("u", 0),
      ch("f", 9),
      ch("l", 9),
      ch("y", 20),
    ]);
    expect(out.get(1)).toEqual(new Set(["u", "y"]));
  });

  it("keeps characters at the same place when different fonts draw them", () => {
    const out = observedCharacters([ch("a", 0), ch("b", 0, { fontKey: 2 })]);
    expect(out.get(1)).toEqual(new Set(["a"]));
    expect(out.get(2)).toEqual(new Set(["b"]));
  });

  it("ignores a generated neighbour at the same place", () => {
    const out = observedCharacters([
      ch("a", 0),
      ch(" ", 0, { generated: true }),
    ]);
    expect(out.get(1)).toEqual(new Set(["a"]));
  });

  it("skips empty characters", () => {
    expect(observedCharacters([ch("", 0)]).size).toBe(0);
  });
});

describe("originalFontCanWrite", () => {
  const observed = new Set("Total amount due is 1250 dollars.");

  it("accepts text made only of characters the subset has drawn", () => {
    expect(
      originalFontCanWrite("Total 1520 dollars.", sans, observed, fakeMetrics),
    ).toBe(true);
  });

  it("refuses characters the subset has not drawn", () => {
    expect(
      originalFontCanWrite("Total 1300", sans, observed, fakeMetrics),
    ).toBe(false);
    expect(originalFontCanWrite("Quote", sans, observed, fakeMetrics)).toBe(
      false,
    );
  });

  it("lets a non-embedded standard font write any character it encodes", () => {
    const helvetica = { ...sans, baseName: "Helvetica", embedded: false };
    expect(
      originalFontCanWrite("Quiz 309", helvetica, new Set(), fakeMetrics),
    ).toBe(true);
    expect(originalFontCanWrite("₹", helvetica, new Set(), fakeMetrics)).toBe(
      false,
    );
  });

  it("treats a non-embedded non-standard font like a subset", () => {
    const arial = { ...sans, baseName: "Arial", embedded: false };
    expect(originalFontCanWrite("Z", arial, new Set("A"), fakeMetrics)).toBe(
      false,
    );
  });
});

describe("continuesLine", () => {
  it("joins a kerned pair split by the producer, without a space", () => {
    // Chrome writes "T" and "otal ..." as two objects; the second starts
    // inside the first's glyph box (kerning).
    expect(
      continuesLine(
        fragment(1, "T", 30, 36.45),
        fragment(2, "otal", 34.63, 60),
      ),
    ).toEqual({ space: false });
  });

  it("adds a space for a word-sized gap", () => {
    expect(
      continuesLine(fragment(1, "Hello", 30, 60), fragment(2, "World", 64, 90)),
    ).toEqual({ space: true });
  });

  it("does not add a second space", () => {
    expect(
      continuesLine(
        fragment(1, "Hello ", 30, 60),
        fragment(2, "World", 64, 90),
      ),
    ).toEqual({ space: false });
  });

  it.each([
    ["another font", { fontKey: 2 }],
    ["another size", { fontSize: 12 }],
    ["another colour", { color: { r: 255, g: 0, b: 0 } }],
    ["another render mode", { renderMode: 1 }],
  ])("keeps %s apart", (_label, change) => {
    expect(
      continuesLine(
        fragment(1, "a", 30, 40),
        fragment(2, "b", 41, 50, change as Partial<TextFragment>),
      ),
    ).toBeNull();
  });

  it("keeps other baselines, earlier positions and far columns apart", () => {
    const prev = fragment(1, "a", 30, 40);
    const below = fragment(2, "b", 41, 50, {
      matrix: [0.75, 0, 0, 0.75, 41, 130],
    });
    expect(continuesLine(prev, below)).toBeNull();
    expect(continuesLine(prev, fragment(2, "b", 20, 25))).toBeNull();
    expect(continuesLine(prev, fragment(2, "b", 60, 70))).toBeNull(); // gap > one font size
  });

  it("keeps differently oriented text apart", () => {
    const rotated = fragment(2, "b", 41, 50, {
      matrix: [0, 0.75, -0.75, 0, 41, 148.38],
    });
    expect(continuesLine(fragment(1, "a", 30, 40), rotated)).toBeNull();
  });
});

describe("unitFrame", () => {
  it("keeps directions and origin, drops scale", () => {
    expect(unitFrame([0.75, 0, 0, 0.75, 30, 40])).toEqual([1, 0, 0, 1, 30, 40]);
    const [a, b, c, d] = unitFrame([3, 4, 0, 2, 0, 0]);
    expect([a, b, c, d]).toEqual([0.6, 0.8, 0, 1]);
  });

  it("leaves a degenerate axis at zero instead of dividing by zero", () => {
    expect(unitFrame([0, 0, 0, 0, 1, 2])).toEqual([0, 0, 0, 0, 1, 2]);
  });
});

describe("groupFragments", () => {
  it("merges a line split into fragments and keeps other lines apart", () => {
    const runs = groupFragments([
      fragment(0, "T", 30, 36.45),
      fragment(1, "otal amount due", 34.63, 120),
      fragment(2, "Next", 30, 50, {
        matrix: [0.75, 0, 0, 0.75, 30, 128.88],
        bounds: { left: 30, bottom: 128, right: 50, top: 137 },
      }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      id: "0-1",
      indices: [0, 1],
      text: "Total amount due",
      box: { left: 30, bottom: 148.2, right: 120, top: 156.5 },
      style: { family: "sans", bold: false, italic: false },
      color: black,
    });
    expect(runs[0].fontSize).toBeCloseTo(10.5);
    // unit axes at the first fragment's origin; width to the last bound
    expect(runs[0].baseline).toEqual([1, 0, 0, 1, 30, 148.38]);
    expect(runs[0].width).toBeCloseTo(90);
    expect(runs[1]).toMatchObject({ id: "2", text: "Next" });
  });

  it("measures a rotated line along its own baseline", () => {
    // text running up the page: x axis (0, 1), y axis (-1, 0)
    const [run] = groupFragments([
      fragment(0, "Up", 200, 0, {
        matrix: [0, 2, -2, 0, 200, 100],
        bounds: { left: 190, bottom: 100, right: 200, top: 130 },
      }),
    ]);
    expect(run.baseline).toEqual([0, 1, -1, 0, 200, 100]);
    expect(run.width).toBeCloseTo(30);
    expect(run.fontSize).toBeCloseTo(28);
  });

  it("returns nothing for a page without text", () => {
    expect(groupFragments([])).toEqual([]);
  });
});
