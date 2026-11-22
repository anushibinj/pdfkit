import { describe, expect, it } from "vitest";
import {
  A4,
  PAGE_SIDE_LIMITS,
  clampPageSide,
  displayedSize,
  isLandscape,
  pagesOfSource,
  sourceMap,
  type BoardSource,
} from "./board";

const source: BoardSource = {
  id: "s1",
  name: "report.pdf",
  colorIndex: 0,
  passwordProtected: false,
  pages: [
    // 600 x 400 box that does not start at the origin, no /Rotate.
    { box: { left: 100, bottom: 50, right: 700, top: 450 }, rotation: 0 },
    // Portrait page with /Rotate 90: shown landscape.
    { box: { left: 0, bottom: 0, right: 300, top: 500 }, rotation: 1 },
  ],
};
const sources = sourceMap([source]);

describe("sourceMap", () => {
  it("indexes sources by id", () => {
    expect(sources.get("s1")).toBe(source);
    expect(sources.get("nope")).toBeUndefined();
  });
});

describe("pagesOfSource", () => {
  it("creates one unrotated page per file page, with fresh keys", () => {
    let n = 0;
    const pages = pagesOfSource("s1", 3, () => `k${++n}`);
    expect(pages).toEqual([
      { kind: "source", key: "k1", sourceId: "s1", pageIndex: 0, rotation: 0 },
      { kind: "source", key: "k2", sourceId: "s1", pageIndex: 1, rotation: 0 },
      { kind: "source", key: "k3", sourceId: "s1", pageIndex: 2, rotation: 0 },
    ]);
  });
});

describe("displayedSize", () => {
  it("uses the box size of an unrotated page", () => {
    const page = {
      kind: "source" as const,
      key: "a",
      sourceId: "s1",
      pageIndex: 0,
      rotation: 0 as const,
    };
    expect(displayedSize(page, sources)).toEqual({ width: 600, height: 400 });
  });

  it("combines the page's /Rotate with the user's turns", () => {
    const page = {
      kind: "source" as const,
      key: "b",
      sourceId: "s1",
      pageIndex: 1,
      rotation: 0 as const,
    };
    expect(displayedSize(page, sources)).toEqual({ width: 500, height: 300 });
    expect(displayedSize({ ...page, rotation: 1 }, sources)).toEqual({
      width: 300,
      height: 500,
    });
  });

  it("turns a blank page by the user's rotation only", () => {
    const blank = {
      kind: "blank" as const,
      key: "x",
      width: 200,
      height: 100,
      rotation: 3 as const,
    };
    expect(displayedSize(blank, sources)).toEqual({ width: 100, height: 200 });
  });

  it("returns null for an unknown file or page", () => {
    const page = {
      kind: "source" as const,
      key: "c",
      sourceId: "s1",
      pageIndex: 9,
      rotation: 0 as const,
    };
    expect(displayedSize(page, sources)).toBeNull();
    expect(displayedSize({ ...page, sourceId: "nope" }, sources)).toBeNull();
  });
});

describe("isLandscape", () => {
  it("is true only when wider than tall", () => {
    expect(isLandscape({ width: 2, height: 1 })).toBe(true);
    expect(isLandscape({ width: 1, height: 2 })).toBe(false);
    expect(isLandscape({ width: 1, height: 1 })).toBe(false);
  });
});

describe("clampPageSide", () => {
  it("keeps sides within the PDF limits", () => {
    expect(clampPageSide(1, A4.width)).toBe(PAGE_SIDE_LIMITS.min);
    expect(clampPageSide(1e9, A4.width)).toBe(PAGE_SIDE_LIMITS.max);
    expect(clampPageSide(612, A4.width)).toBe(612);
  });

  it("falls back for non-finite input", () => {
    expect(clampPageSide(Number.NaN, A4.width)).toBe(A4.width);
    expect(clampPageSide(Infinity, A4.height)).toBe(A4.height);
  });
});
