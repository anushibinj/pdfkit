import { describe, expect, it } from "vitest";
import {
  buildOcrReport,
  countNonWhitespaceChars,
  countWords,
  formatOcrSummary,
} from "./report";

describe("OCR report", () => {
  it("counts words and non-whitespace characters across Latin and Indic scripts", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
    expect(countWords("Hello   नमस्ते  भारत")).toBe(3);
    expect(countNonWhitespaceChars("A B\nनमस्ते")).toBe(8);
  });

  it("aggregates single-page and multi-page reports accurately", () => {
    const single = buildOcrReport([
      {
        pageIndex: 0,
        status: "ocr",
        text: "Hello world",
        confidence: 92,
        wordCount: 2,
      },
    ]);
    expect(single.totalPages).toBe(1);
    expect(single.ocrPagesCount).toBe(1);
    expect(single.skippedPagesCount).toBe(0);
    expect(single.averageConfidence).toBe(92);
    expect(single.totalWords).toBe(2);
    expect(single.fullText).toBe("Hello world");

    const multi = buildOcrReport([
      {
        pageIndex: 0,
        status: "ocr",
        text: "Page one",
        confidence: 90,
        wordCount: 2,
      },
      {
        pageIndex: 1,
        status: "skipped-existing-text",
        text: "Existing text",
        confidence: null,
        wordCount: 2,
      },
      {
        pageIndex: 2,
        status: "ocr",
        text: "",
        confidence: 80,
        wordCount: 0,
      },
    ]);
    expect(multi.ocrPagesCount).toBe(2);
    expect(multi.skippedPagesCount).toBe(1);
    expect(multi.averageConfidence).toBe(85);
    expect(multi.totalWords).toBe(4);
    expect(multi.fullText).toContain("--- Page 1 ---\nPage one");
    expect(multi.fullText).toContain("--- Page 2 ---\nExisting text");
    expect(multi.fullText).toContain("--- Page 3 ---\n(no text detected)");
  });

  it("formats clear human-readable summaries", () => {
    expect(
      formatOcrSummary(
        buildOcrReport([
          {
            pageIndex: 0,
            status: "ocr",
            text: "one two",
            confidence: 94,
            wordCount: 2,
          },
          {
            pageIndex: 1,
            status: "skipped-existing-text",
            text: "three",
            confidence: null,
            wordCount: 1,
          },
        ]),
      ),
    ).toBe("1 page recognized (94% avg. confidence), 1 page with existing text skipped · 3 words");

    expect(formatOcrSummary(buildOcrReport([]))).toBe("No pages processed");
  });
});
