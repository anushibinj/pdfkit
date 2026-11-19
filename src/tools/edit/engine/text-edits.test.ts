import { describe, expect, it } from "vitest";
import type { Matrix } from "../core/affine";
import type {
  FontDescription,
  PageTextSnapshot,
  TextFragment,
} from "../core/text-runs";
import { fakeMetrics } from "../test-utils/fake-metrics";
import { applyTextEdits, sameGlyphs, type TextSurface } from "./text-edits";

const subset: FontDescription = {
  baseName: "AAAAAA+DejaVuSerif-Bold",
  family: "DejaVu Serif",
  flags: 6,
  weight: 700,
  italicAngle: 0,
  embedded: true,
};

/** A fragment on the baseline y = 100, 10 pt text, 5 pt per character. */
function fragment(index: number, text: string, x: number): TextFragment {
  const matrix: Matrix = [1, 0, 0, 1, x, 100];
  return {
    index,
    text,
    fontKey: 7,
    font: subset,
    fontSize: 10,
    matrix,
    bounds: { left: x, bottom: 98, right: x + text.length * 5, top: 108 },
    color: { r: 0, g: 0, b: 0 },
    renderMode: 0,
  };
}

/**
 * An in-memory page. Objects are kept by index; `dropped` lists characters
 * the "font" silently loses when written in place, to imitate a subset
 * font without that glyph.
 */
class FakeSurface implements TextSurface {
  readonly texts = new Map<number, string>();
  readonly fonts = new Map<number, string>();
  readonly log: string[] = [];
  dropped = new Set<string>();

  constructor(private readonly snapshot: PageTextSnapshot) {
    for (const f of snapshot.fragments) this.texts.set(f.index, f.text);
  }

  read(): PageTextSnapshot {
    this.log.push("read");
    return this.snapshot;
  }

  setText(index: number, text: string): void {
    this.log.push(`set ${index}`);
    this.texts.set(
      index,
      [...text].filter((c) => !this.dropped.has(c)).join(""),
    );
  }

  replace(index: number, fontName: string, text: string): void {
    this.log.push(`replace ${index}`);
    if (!this.texts.has(index)) throw new Error(`no object ${index}`);
    this.texts.set(index, text);
    this.fonts.set(index, fontName);
  }

  remove(index: number): void {
    this.log.push(`remove ${index}`);
    if (!this.texts.delete(index)) throw new Error(`no object ${index}`);
  }

  readBack(indices: readonly number[]): Map<number, string> {
    this.log.push(`readBack ${indices.join(",")}`);
    return new Map(indices.map((i) => [i, this.texts.get(i) ?? ""]));
  }
}

/** "Total due 1250" split in two, then a separate line further down. */
function page(): FakeSurface {
  const second: TextFragment = {
    ...fragment(5, "Contact", 0),
    matrix: [1, 0, 0, 1, 0, 50],
  };
  return new FakeSurface({
    fragments: [fragment(2, "Total", 0), fragment(3, "due 1250", 28), second],
    observed: new Map([[7, new Set("Totaldue1250 Contac")]]),
  });
}

describe("sameGlyphs", () => {
  it("ignores whitespace only", () => {
    expect(sameGlyphs("Total due ", " Total  due")).toBe(true);
    expect(sameGlyphs("Total due", "Totl due")).toBe(false);
  });
});

describe("applyTextEdits", () => {
  it("does nothing, not even reading, without edits", () => {
    const s = page();
    expect(applyTextEdits(s, [], fakeMetrics)).toEqual([]);
    expect(s.log).toEqual([]);
  });

  it("rewrites a line in its own font when the font has every character", () => {
    const s = page();
    const out = applyTextEdits(
      s,
      [{ runId: "2-3", text: "Total due 1520" }],
      fakeMetrics,
    );
    expect(out).toEqual([
      {
        runId: "2-3",
        applied: true,
        written: "Total due 1520",
        substituteFont: null,
      },
    ]);
    // the whole line goes into the first fragment; the rest is removed
    expect(s.texts.get(2)).toBe("Total due 1520");
    expect(s.texts.has(3)).toBe(false);
    expect(s.fonts.size).toBe(0);
    expect(s.log).toEqual(["read", "set 2", "remove 3", "readBack 2"]);
  });

  it("uses the closest standard font when the font lacks a character", () => {
    const s = page();
    const [out] = applyTextEdits(
      s,
      [{ runId: "2-3", text: "Total due 1300" }], // no "3" in the subset
      fakeMetrics,
    );
    expect(out).toEqual({
      runId: "2-3",
      applied: true,
      written: "Total due 1300",
      substituteFont: "Times-Bold", // bold serif, like DejaVu Serif Bold
    });
    expect(s.fonts.get(2)).toBe("Times-Bold");
    expect(s.texts.has(3)).toBe(false);
    expect(s.log).not.toContain("set 2");
  });

  it("falls back when the read-back shows a character went missing", () => {
    const s = page();
    s.dropped = new Set(["0"]); // e.g. "0" only ever drawn inside a ligature
    const [out] = applyTextEdits(
      s,
      [{ runId: "2-3", text: "Total due 1520" }],
      fakeMetrics,
    );
    expect(out.substituteFont).toBe("Times-Bold");
    expect(s.texts.get(2)).toBe("Total due 1520");
    expect(s.log).toEqual([
      "read",
      "set 2",
      "remove 3",
      "readBack 2",
      "replace 2",
    ]);
  });

  it("leaves out characters even the standard font cannot write", () => {
    const s = page();
    const [out] = applyTextEdits(
      s,
      [{ runId: "5", text: "Pay ₹50" }],
      fakeMetrics,
    );
    expect(out.written).toBe("Pay 50");
    expect(s.texts.get(5)).toBe("Pay 50");
  });

  it("removes the line when the fallback has nothing left to write", () => {
    const s = page();
    const [out] = applyTextEdits(
      s,
      [{ runId: "2-3", text: "₹₹" }],
      fakeMetrics,
    );
    expect(out).toMatchObject({ applied: true, written: "" });
    expect(s.texts.has(2)).toBe(false);
    expect(s.texts.has(3)).toBe(false);
  });

  it("deletes a line whose new text is empty", () => {
    const s = page();
    const [out] = applyTextEdits(s, [{ runId: "2-3", text: " " }], fakeMetrics);
    expect(out).toEqual({
      runId: "2-3",
      applied: true,
      written: "",
      substituteFont: null,
    });
    expect([...s.texts.keys()]).toEqual([5]);
  });

  it("reports an unknown line as not applied and changes nothing", () => {
    const s = page();
    const [out] = applyTextEdits(s, [{ runId: "2", text: "x" }], fakeMetrics);
    expect(out).toEqual({
      runId: "2",
      applied: false,
      written: "",
      substituteFont: null,
    });
    expect(s.texts.get(2)).toBe("Total");
  });

  it("applies several edits with one read-back, and a repeated id once", () => {
    const s = page();
    const out = applyTextEdits(
      s,
      [
        { runId: "5", text: "old" },
        { runId: "2-3", text: "Total due 1250" },
        { runId: "5", text: "Contact" },
      ],
      fakeMetrics,
    );
    expect(out.map((o) => o.runId)).toEqual(["5", "2-3"]);
    expect(s.texts.get(5)).toBe("Contact");
    expect(s.log.filter((l) => l.startsWith("readBack"))).toEqual([
      "readBack 5,2",
    ]);
  });
});
