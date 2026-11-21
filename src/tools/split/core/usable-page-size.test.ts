import { describe, expect, it } from "vitest";
import { FALLBACK_PAGE_SIZE, usablePageSize } from "./usable-page-size";

describe("usablePageSize", () => {
  it("keeps a real size", () => {
    expect(usablePageSize(595, 842)).toEqual({ width: 595, height: 842 });
  });

  it.each([
    [0, 842],
    [595, -1],
    [Number.NaN, 842],
    [595, Number.POSITIVE_INFINITY],
  ])("falls back to Letter for %d x %d", (w, h) => {
    expect(usablePageSize(w, h)).toEqual(FALLBACK_PAGE_SIZE);
  });

  it("returns a copy of the fallback, not the shared object", () => {
    expect(usablePageSize(0, 0)).not.toBe(FALLBACK_PAGE_SIZE);
  });
});
