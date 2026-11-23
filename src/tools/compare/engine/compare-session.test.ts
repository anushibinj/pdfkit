import { describe, expect, it, vi } from "vitest";
import type { ExtractedPageText } from "../core/model";
import { tokenizePageChars } from "../core/text-tokens";
import { fakeComparePdfium } from "../test-utils/fake-compare-pdfium";
import { CompareSession, alignedRenderDimensions } from "./compare-session";
import type { PdfTextExtractor } from "./page-text-extractor";
import type { ComparisonReportBuilder } from "./report-builder";

function makeExtracted(pageIndex: number, words: string): ExtractedPageText {
  const chars = Array.from(words).map((char, idx) => ({
    char,
    generated: char === " ",
    box:
      char === " "
        ? null
        : { left: 20 + idx * 5, bottom: 700, right: 24 + idx * 5, top: 712 },
  }));
  const { text, tokens } = tokenizePageChars(chars);
  return {
    pageIndex,
    text,
    tokens,
    hasText: tokens.length > 0,
    info: { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
  };
}

describe("CompareSession", () => {
  it("computes equal-DPI render dimensions for differently sized pages", () => {
    const dims = alignedRenderDimensions(
      { box: { left: 0, bottom: 0, right: 600, top: 800 }, rotation: 0 },
      { box: { left: 0, bottom: 0, right: 300, top: 400 }, rotation: 0 },
      600,
    );
    expect(dims.leftSize).toEqual({ width: 600, height: 800 });
    expect(dims.rightSize).toEqual({ width: 300, height: 400 });
  });

  it("opens both PDFs, aligns pages, computes visual diff, builds report, and cleans up", () => {
    const { api, runtime } = fakeComparePdfium();
    api.FPDF_GetPageCount.mockReturnValue(2);

    const leftTexts = [
      makeExtracted(0, "Clause one original"),
      makeExtracted(1, "Clause two unchanged"),
    ];
    const rightTexts = [
      makeExtracted(0, "Clause one revised"),
      makeExtracted(1, "Clause two unchanged"),
    ];

    let sideCall = 0;
    const extractor: PdfTextExtractor = {
      extractPage: (_doc, idx) => {
        const list = sideCall < 2 ? leftTexts : rightTexts;
        sideCall++;
        return list[idx];
      },
    };
    const reportBuilder: ComparisonReportBuilder = {
      buildReport: vi.fn(() => new Uint8Array([37, 80, 68, 70])),
    };

    const session = new CompareSession(api, { extractor, reportBuilder });

    const leftOut = session.openSide(
      "left",
      "a.pdf",
      new Uint8Array([1, 2]),
      "",
    );
    expect(leftOut.summary).toBeNull();
    expect(leftOut.pageCount).toBe(2);

    const rightOut = session.openSide(
      "right",
      "b.pdf",
      new Uint8Array([3, 4]),
      "",
    );
    expect(rightOut.summary).not.toBeNull();
    expect(rightOut.summary?.totalChanges).toBe(1);
    expect(rightOut.summary?.pairs[0].changes[0].leftText).toBe("original");
    expect(rightOut.summary?.pairs[0].changes[0].rightText).toBe("revised");

    const rendered = session.renderPage("left", 0, 300);
    expect(rendered.width).toBe(300);

    const visual = session.computeVisualDiff(0, 200);
    expect(visual.summary.pairIndex).toBe(0);
    expect(visual.pixels.length).toBe(
      visual.summary.width * visual.summary.height * 4,
    );

    const report = session.buildReport();
    expect(report).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(reportBuilder.buildReport).toHaveBeenCalledTimes(1);
    const buildArg = vi.mocked(reportBuilder.buildReport).mock.calls[0][0];
    // Pair 1 had zero text changes and was not pre-visited in Visual mode;
    // buildReport() must scan it automatically so visual diffs aren't missed.
    expect(buildArg.visualDiffs.has(1)).toBe(true);

    session.closeAll();
    expect(runtime.leaks()).toEqual([]);
  });

  it("populates visual diffs during buildReport even when Visual mode was never opened", () => {
    const { api, runtime } = fakeComparePdfium();
    api.FPDF_GetPageCount.mockReturnValue(1);

    const leftTexts = [makeExtracted(0, "")];
    const rightTexts = [makeExtracted(0, "")];
    let calls = 0;
    const extractor: PdfTextExtractor = {
      extractPage: () => (calls++ === 0 ? leftTexts[0] : rightTexts[0]),
    };
    const reportBuilder: ComparisonReportBuilder = {
      buildReport: vi.fn(() => new Uint8Array([1, 2, 3])),
    };

    const session = new CompareSession(api, { extractor, reportBuilder });
    session.openSide("left", "scan1.pdf", new Uint8Array([1]), "");
    session.openSide("right", "scan2.pdf", new Uint8Array([2]), "");

    session.buildReport();
    const arg = vi.mocked(reportBuilder.buildReport).mock.calls[0][0];
    expect(arg.visualDiffs.size).toBe(1);
    expect(arg.visualDiffs.has(0)).toBe(true);

    session.closeAll();
    expect(runtime.leaks()).toEqual([]);
  });

  it("throws descriptive errors when rendering or reporting before opening", () => {
    const { api } = fakeComparePdfium();
    const session = new CompareSession(api);
    expect(() => session.renderPage("left", 0, 400)).toThrow(
      "No original PDF is currently open.",
    );
    expect(() => session.computeVisualDiff(0, 400)).toThrow(
      "Open both PDFs before running visual comparison.",
    );
    expect(() => session.buildReport()).toThrow(
      "Open both PDFs before exporting a comparison report.",
    );
  });
});
