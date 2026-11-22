import { describe, expect, it } from "vitest";
import type { Matrix } from "@/lib/geometry/affine";
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
 * the line's font silently loses (a subset font without that glyph), both
 * when writing in place and when probing.
 */
class FakeSurface implements TextSurface {
  readonly texts = new Map<number, string>();
  readonly fonts = new Map<number, string>();
  readonly log: string[] = [];
  dropped = new Set<string>();

  constructor(private readonly snapshot: PageTextSnapshot) {
    for (const f of snapshot.fragments) this.texts.set(f.index, f.text);
  }

  private drop(text: string): string {
    return [...text].filter((c) => !this.dropped.has(c)).join("");
  }

  read(): PageTextSnapshot {
    this.log.push("read");
    return this.snapshot;
  }

  setText(index: number, text: string): void {
    this.log.push(`set ${index}`);
    this.texts.set(index, this.drop(text));
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

  probe(
    requests: readonly { index: number; text: string }[],
  ): Map<number, string> {
    this.log.push(`probe ${requests.map((r) => r.index).join(",")}`);
    return new Map(requests.map((r) => [r.index, this.drop(r.text)]));
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
  const kept = (runId: string, written: string) => ({
    runId,
    applied: true,
    failure: null,
    written,
    substituteFont: null,
  });

  it("does nothing, not even reading, without edits", () => {
    const s = page();
    expect(applyTextEdits(s, [], fakeMetrics)).toEqual([]);
    expect(s.log).toEqual([]);
  });

  it("rewrites a line in its own font once a probe confirms every character", () => {
    const s = page();
    const out = applyTextEdits(
      s,
      [{ runId: "2-3", text: "Total due 1520" }],
      fakeMetrics,
    );
    expect(out).toEqual([kept("2-3", "Total due 1520")]);
    // the whole line goes into the first fragment; the rest is removed
    expect(s.texts.get(2)).toBe("Total due 1520");
    expect(s.texts.has(3)).toBe(false);
    expect(s.fonts.size).toBe(0);
    expect(s.log).toEqual(["read", "probe 2", "set 2", "remove 3"]);
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
      failure: null,
      written: "Total due 1300",
      substituteFont: "Times-Bold", // bold serif, like DejaVu Serif Bold
    });
    expect(s.fonts.get(2)).toBe("Times-Bold");
    expect(s.texts.has(3)).toBe(false);
    expect(s.log).toEqual(["read", "replace 2", "remove 3"]);
  });

  it("falls back when the probe shows a character would go missing", () => {
    const s = page();
    s.dropped = new Set(["0"]); // e.g. "0" only ever drawn inside a ligature
    const [out] = applyTextEdits(
      s,
      [{ runId: "2-3", text: "Total due 1520" }],
      fakeMetrics,
    );
    expect(out.substituteFont).toBe("Times-Bold");
    expect(s.texts.get(2)).toBe("Total due 1520");
    // the line itself was never written in its own font
    expect(s.log).toEqual(["read", "probe 2", "replace 2", "remove 3"]);
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

  it("leaves a line exactly as it was when no font can write the text", () => {
    const s = page();
    const [out] = applyTextEdits(
      s,
      [{ runId: "2-3", text: "₹₹" }],
      fakeMetrics,
    );
    expect(out).toEqual({
      runId: "2-3",
      applied: false,
      failure: "no-font",
      written: "",
      substituteFont: null,
    });
    expect(s.texts.get(2)).toBe("Total");
    expect(s.texts.get(3)).toBe("due 1250");
    expect(s.log).toEqual(["read"]);
  });

  it("also after a failed probe: the original was not touched", () => {
    // The subset seems to have ₹ (it drew one) but would drop it anyway.
    const s = new FakeSurface({
      fragments: [fragment(2, "₹ 5", 0)],
      observed: new Map([[7, new Set("₹ 5")]]),
    });
    s.dropped = new Set(["₹"]);
    const [out] = applyTextEdits(s, [{ runId: "2", text: "₹₹" }], fakeMetrics);
    expect(out.failure).toBe("no-font");
    expect(s.texts.get(2)).toBe("₹ 5");
    expect(s.log).toEqual(["read", "probe 2"]);
  });

  it("deletes a line whose new text is empty", () => {
    const s = page();
    const [out] = applyTextEdits(s, [{ runId: "2-3", text: " " }], fakeMetrics);
    expect(out).toEqual(kept("2-3", ""));
    expect([...s.texts.keys()]).toEqual([5]);
  });

  it("changes nothing when the text is the line's own", () => {
    const s = page();
    const [out] = applyTextEdits(
      s,
      [{ runId: "5", text: "Contact" }],
      fakeMetrics,
    );
    expect(out).toEqual(kept("5", "Contact"));
    expect(s.log).toEqual(["read"]);
  });

  it("reports an unknown line as not applied and changes nothing", () => {
    const s = page();
    const [out] = applyTextEdits(s, [{ runId: "2", text: "x" }], fakeMetrics);
    expect(out).toEqual({
      runId: "2",
      applied: false,
      failure: "line-not-found",
      written: "",
      substituteFont: null,
    });
    expect(s.texts.get(2)).toBe("Total");
  });

  it("probes several edits at once, and applies a repeated id once", () => {
    const s = page();
    const out = applyTextEdits(
      s,
      [
        { runId: "5", text: "old" },
        { runId: "2-3", text: "Total due 1250 1" },
        { runId: "5", text: "Contact 2" },
      ],
      fakeMetrics,
    );
    expect(out.map((o) => o.runId)).toEqual(["5", "2-3"]);
    expect(s.texts.get(5)).toBe("Contact 2");
    expect(s.log.filter((l) => l.startsWith("probe"))).toEqual(["probe 5,2"]);
  });
});
