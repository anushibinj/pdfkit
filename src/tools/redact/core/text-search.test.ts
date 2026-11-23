import { describe, expect, it } from "vitest";
import type { TextFragment } from "@/tools/edit/core/text-runs";
import { EMAIL_PRESET } from "./presets";
import {
  boxesOverlap,
  buildSearchablePageText,
  extractTextUnderBox,
  isCharCoveredByBox,
  locatePatternMatchesOnPage,
  splitTextObjectByBoxes,
  type PageCharWithBox,
} from "./text-search";

function makeWordChars(
  word: string,
  startX: number,
  y: number,
  textObjectIndex = 0,
  charWidth = 6,
): PageCharWithBox[] {
  return [...word].map((char, i) => ({
    char,
    x: startX + i * charWidth,
    y,
    box: {
      left: startX + i * charWidth,
      bottom: y - 2,
      right: startX + (i + 1) * charWidth,
      top: y + 10,
    },
    textObjectIndex,
  }));
}

function makeFragment(index: number, text: string, left: number, right: number): TextFragment {
  return {
    index,
    text,
    fontKey: 1,
    font: {
      baseName: "Helvetica",
      family: "Helvetica",
      flags: 0,
      weight: 400,
      italicAngle: 0,
      embedded: false,
    },
    fontSize: 12,
    matrix: [1, 0, 0, 1, left, 700],
    bounds: { left, bottom: 698, right, top: 710 },
    color: { r: 0, g: 0, b: 0 },
    renderMode: 0,
  };
}

describe("text-search", () => {
  it("computes box overlap and glyph coverage accurately", () => {
    expect(
      boxesOverlap(
        { left: 0, bottom: 0, right: 10, top: 10 },
        { left: 10, bottom: 5, right: 20, top: 15 },
      ),
    ).toBe(true);
    expect(
      boxesOverlap(
        { left: 0, bottom: 0, right: 10, top: 10 },
        { left: 11, bottom: 0, right: 20, top: 10 },
      ),
    ).toBe(false);

    // Center inside box
    expect(
      isCharCoveredByBox(
        { left: 10, bottom: 10, right: 20, top: 20 },
        { left: 12, bottom: 12, right: 18, top: 18 },
      ),
    ).toBe(true);
    // >= 25% area overlap near edge
    expect(
      isCharCoveredByBox(
        { left: 10, bottom: 10, right: 20, top: 20 },
        { left: 17, bottom: 10, right: 25, top: 20 },
      ),
    ).toBe(true);
    // Tiny sliver < 25%
    expect(
      isCharCoveredByBox(
        { left: 10, bottom: 10, right: 20, top: 20 },
        { left: 19, bottom: 10, right: 25, top: 20 },
      ),
    ).toBe(false);
  });

  it("builds searchable page text with word spaces and line breaks", () => {
    const chars = [
      ...makeWordChars("Email:", 50, 700, 0),
      ...makeWordChars("alice@example.com", 95, 700, 1),
      ...makeWordChars("NextLine", 50, 680, 2),
    ];
    const searchable = buildSearchablePageText(chars);
    expect(searchable.text).toBe("Email: alice@example.com\nNextLine");
    expect(searchable.charRefs[6]).toBeNull(); // inserted space
    expect(searchable.charRefs[7]?.char).toBe("a");
  });

  it("locates preset matches on a page and extracts text under a manual box", () => {
    const chars = [
      ...makeWordChars("Contact", 50, 700, 0),
      ...makeWordChars("alice@example.com", 100, 700, 0),
      ...makeWordChars("today", 210, 700, 0),
    ];
    const marks = locatePatternMatchesOnPage(0, chars, EMAIL_PRESET);
    expect(marks).toHaveLength(1);
    expect(marks[0].term).toBe("alice@example.com");
    expect(marks[0].source).toBe("email");
    expect(marks[0].box.left).toBeCloseTo(99.5, 5);

    const extracted = extractTextUnderBox(chars, marks[0].box);
    expect(extracted).toBe("alice@example.com");
  });

  it("splits straddling text objects into surviving left and right spans", () => {
    // One single text object holding "Hello alice@example.com world"
    const chars = [
      ...makeWordChars("Hello", 50, 700, 0),
      ...makeWordChars("alice@example.com", 86, 700, 0),
      ...makeWordChars("world", 194, 700, 0),
    ];
    const frag = makeFragment(0, "Hello alice@example.com world", 50, 224);
    const otherFrag = makeFragment(1, "Untouched", 50, 110);
    const allChars = [...chars, ...makeWordChars("Untouched", 50, 660, 1)];

    const actions = splitTextObjectByBoxes(
      [frag, otherFrag],
      allChars,
      [{ left: 85, bottom: 695, right: 190, top: 715 }],
    );

    expect(actions[1]).toEqual({ kind: "keep", fragmentIndex: 1 });
    expect(actions[0]).toEqual({
      kind: "split",
      fragmentIndex: 0,
      spans: [
        { text: "Hello", originX: 50, originY: 700 },
        { text: "world", originX: 194, originY: 700 },
      ],
    });
  });

  it("marks wholly covered text objects for removal", () => {
    const chars = makeWordChars("SECRET", 50, 700, 0);
    const frag = makeFragment(0, "SECRET", 50, 86);
    const actions = splitTextObjectByBoxes([frag], chars, [
      { left: 45, bottom: 690, right: 95, top: 720 },
    ]);
    expect(actions).toEqual([{ kind: "remove", fragmentIndex: 0 }]);
  });
});
