import { describe, expect, it } from "vitest";
import type { ExtractedPageText } from "./model";
import { diffPageText, JsDiffWordEngine, type WordDiffEngine } from "./text-diff";
import { tokenizePageChars } from "./text-tokens";

function makePage(pageIndex: number, content: string): ExtractedPageText {
  const chars = Array.from(content).map((char, idx) => ({
    char,
    generated: char === " ",
    box:
      char === " "
        ? null
        : { left: 10 + idx * 6, bottom: 700, right: 15 + idx * 6, top: 712 },
  }));
  const { text, tokens } = tokenizePageChars(chars);
  return {
    pageIndex,
    text,
    tokens,
    hasText: tokens.length > 0,
    info: {
      box: { left: 0, bottom: 0, right: 612, top: 792 },
      rotation: 0,
    },
  };
}

describe("text-diff", () => {
  it("detects a changed clause, an inserted phrase, and a deleted word with boxes", () => {
    const left = makePage(
      0,
      "Payment is 1250 dollars due immediately upon receipt.",
    );
    const right = makePage(
      0,
      "Payment is 1520 dollars due within thirty days upon receipt.",
    );

    const changes = diffPageText(0, left, right);
    expect(changes).toHaveLength(2);

    expect(changes[0].kind).toBe("modified");
    expect(changes[0].leftText).toBe("1250");
    expect(changes[0].rightText).toBe("1520");
    expect(changes[0].leftUserRects.length).toBeGreaterThan(0);
    expect(changes[0].rightUserRects.length).toBeGreaterThan(0);
    expect(changes[0].leftViewRects.length).toBeGreaterThan(0);
    expect(changes[0].rightViewRects.length).toBeGreaterThan(0);

    expect(changes[1].kind).toBe("modified");
    expect(changes[1].leftText).toBe("immediately");
    expect(changes[1].rightText).toBe("within thirty days");
  });

  it("handles pure insertions and pure deletions", () => {
    const left = makePage(0, "Alpha beta gamma");
    const right = makePage(0, "Alpha extra beta");

    const changes = diffPageText(0, left, right);
    expect(changes.map((c) => c.kind)).toEqual(["added", "removed"]);
    expect(changes[0].rightText).toBe("extra");
    expect(changes[1].leftText).toBe("gamma");
  });

  it("creates whole-page changes for unmatched added or removed pages", () => {
    const page = makePage(0, "Standalone page content");
    const added = diffPageText(2, null, page);
    expect(added).toHaveLength(1);
    expect(added[0].kind).toBe("added");
    expect(added[0].rightText).toBe("Standalone page content");

    const removed = diffPageText(3, page, null);
    expect(removed).toHaveLength(1);
    expect(removed[0].kind).toBe("removed");
    expect(removed[0].leftText).toBe("Standalone page content");

    expect(diffPageText(0, null, null)).toEqual([]);
  });

  it("supports injecting a custom WordDiffEngine (DIP)", () => {
    const customEngine: WordDiffEngine = {
      diff: (l, r) => [
        { value: [...l], removed: true, added: false, count: l.length },
        { value: [...r], added: true, removed: false, count: r.length },
      ],
    };
    const left = makePage(0, "foo");
    const right = makePage(0, "foo");
    const changes = diffPageText(0, left, right, customEngine);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("modified");
    expect(new JsDiffWordEngine().diff(["a"], ["a"])[0].added).toBeFalsy();
  });
});
