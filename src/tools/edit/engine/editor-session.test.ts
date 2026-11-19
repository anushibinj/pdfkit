import { describe, expect, it } from "vitest";
import { fakeMetrics } from "../test-utils/fake-metrics";
import { fakePdfium } from "../test-utils/fake-pdfium";
import {
  EditorSession,
  MAX_RENDER_PIXELS,
  MAX_RENDER_WIDTH,
  fitRenderSize,
} from "./editor-session";

describe("fitRenderSize", () => {
  it("follows the page's aspect ratio", () => {
    expect(fitRenderSize({ width: 600, height: 400 }, 900)).toEqual({
      width: 900,
      height: 600,
    });
  });

  it("clamps the width and survives junk input", () => {
    expect(fitRenderSize({ width: 200, height: 100 }, 99_999)).toEqual({
      width: MAX_RENDER_WIDTH,
      height: MAX_RENDER_WIDTH / 2,
    });
    expect(fitRenderSize({ width: 100, height: 100 }, Number.NaN)).toEqual({
      width: 1,
      height: 1,
    });
    expect(fitRenderSize({ width: 0, height: 100 }, 10)).toEqual({
      width: 10,
      height: 10,
    });
  });

  it("shrinks very tall pages under the pixel budget, keeping the shape", () => {
    const size = fitRenderSize({ width: 100, height: 10_000 }, 1000);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    expect(size.height / size.width).toBeCloseTo(100, 0);
  });
});

describe("EditorSession", () => {
  function setup() {
    const { api, runtime } = fakePdfium();
    api.FPDF_GetPageCount.mockReturnValue(2);
    return { api, runtime, session: new EditorSession(api, fakeMetrics) };
  }

  it("open reads every page and replaces a previously open file", () => {
    const { api, runtime, session } = setup();
    expect(session.open(new Uint8Array(2), "")).toHaveLength(2);
    session.open(new Uint8Array(2), "pw");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(api.FPDF_LoadMemDocument).toHaveBeenLastCalledWith(
      expect.any(Number),
      2,
      "pw",
    );
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("open refuses a file without pages and releases it", () => {
    const { api, runtime, session } = setup();
    api.FPDF_GetPageCount.mockReturnValue(0);
    expect(() => session.open(new Uint8Array(2), "")).toThrow("no pages");
    expect(session.isOpen()).toBe(false);
    expect(runtime.leaks()).toEqual([]);
  });

  it("render needs an open file (requireView)", () => {
    const { session } = setup();
    expect(() => session.render(0, 0, 100)).toThrow("No PDF is open");
  });

  it("save works on a fresh copy and always closes it", () => {
    const { api, runtime, session } = setup();
    session.open(new Uint8Array(2), "pw");
    api.PDFiumExt_SaveAsCopy.mockReturnValue(0);
    expect(() =>
      session.save({
        pages: [0, 1].map((i) => ({
          sourceIndex: i,
          rotation: 0,
          objects: [],
        })),
        images: [],
      }),
    ).toThrow("could not save");
    // opened twice (view + copy), the copy already closed again
    expect(api.FPDF_LoadMemDocument).toHaveBeenCalledTimes(2);
    expect(api.FPDF_LoadMemDocument).toHaveBeenLastCalledWith(
      expect.any(Number),
      2,
      "pw",
    );
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("save needs an open file (requireView)", () => {
    const { session } = setup();
    expect(() => session.save({ pages: [], images: [] })).toThrow(
      "No PDF is open",
    );
  });

  it("close is safe to repeat", () => {
    const { session } = setup();
    session.close();
    session.close();
    expect(session.isOpen()).toBe(false);
  });
});
