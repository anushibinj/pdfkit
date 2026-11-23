import { describe, expect, it } from "vitest";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { CompareSummary, VisualDiffSummary } from "../core/model";
import { fakeComparePdfium } from "../test-utils/fake-compare-pdfium";
import { FPDF_ANNOT_HIGHLIGHT, FPDF_ANNOT_SQUARE } from "./pdfium-api";
import {
  PdfiumComparisonReportBuilder,
  buildSummaryLines,
  toSummaryAscii,
  truncateNote,
} from "./report-builder";

describe("report-builder", () => {
  const sampleSummary: CompareSummary = {
    leftFileName: "contract-v1—draft.pdf",
    rightFileName: "contract-v2.pdf",
    leftPageCount: 2,
    rightPageCount: 2,
    totalChanges: 1,
    addedWords: 1,
    removedWords: 1,
    scannedPagesCount: 1,
    pairs: [
      {
        pairIndex: 0,
        leftIndex: 0,
        rightIndex: 0,
        status: "matched",
        similarity: 0.9,
        leftHasText: true,
        rightHasText: true,
        leftInfo: {
          box: { left: 0, bottom: 0, right: 612, top: 792 },
          rotation: 0,
        },
        rightInfo: {
          box: { left: 0, bottom: 0, right: 612, top: 792 },
          rotation: 0,
        },
        changes: [
          {
            id: "p0-c0",
            pairIndex: 0,
            kind: "modified",
            leftText: "1250",
            rightText: "1520",
            leftUserRects: [{ left: 72, bottom: 700, right: 100, top: 712 }],
            rightUserRects: [{ left: 72, bottom: 700, right: 100, top: 712 }],
            leftViewRects: [{ left: 0.1, top: 0.1, right: 0.2, bottom: 0.12 }],
            rightViewRects: [{ left: 0.1, top: 0.1, right: 0.2, bottom: 0.12 }],
            anchorY: 0.1,
          },
        ],
      },
      {
        pairIndex: 1,
        leftIndex: 1,
        rightIndex: 1,
        status: "matched",
        similarity: 1,
        leftHasText: false,
        rightHasText: false,
        leftInfo: {
          box: { left: 0, bottom: 0, right: 612, top: 792 },
          rotation: 0,
        },
        rightInfo: {
          box: { left: 0, bottom: 0, right: 612, top: 792 },
          rotation: 0,
        },
        changes: [],
      },
    ],
  };

  it("sanitises ASCII strings and truncates long notes", () => {
    expect(toSummaryAscii("Café\nReport—2026")).toBe("Caf? Report?2026");
    expect(truncateNote("hello world", 20)).toBe("hello world");
    expect(truncateNote("hello world", 8)).toBe("hello...");
  });

  it("truncates overly long file names in cover summary lines", () => {
    const longName = `${"very-long-contract-name-".repeat(5)}.pdf`;
    const lines = buildSummaryLines(
      { ...sampleSummary, leftFileName: longName, rightFileName: longName },
      new Map(),
    );
    expect(lines[1].text).toContain("...");
    expect(lines[1].text.length).toBeLessThan(120);
    expect(lines[2].text).toContain("...");
  });

  it("builds cover summary lines including scanned-page notice and visual diff percentage", () => {
    const visual = new Map<number, VisualDiffSummary>([
      [
        1,
        {
          pairIndex: 1,
          width: 400,
          height: 500,
          leftWidth: 400,
          leftHeight: 500,
          rightWidth: 400,
          rightHeight: 500,
          sizeMismatch: false,
          changedPixels: 120,
          totalPixels: 200_000,
          percentChanged: 0.06,
          regions: [
            { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4, pixelCount: 120 },
          ],
        },
      ],
    ]);

    const lines = buildSummaryLines(sampleSummary, visual);
    expect(lines[0].text).toBe("PDF Comparison Report");
    expect(lines.some((l) => l.text.includes("no extractable text layer"))).toBe(
      true,
    );
    expect(lines.some((l) => l.text.includes("Visual: 0.06% changed"))).toBe(
      true,
    );
  });

  it("creates summary page, imports pair pages, and emits Highlight + Square annotations with AP streams", () => {
    const { api, runtime } = fakeComparePdfium();
    const heap = new WasmHeap(api.pdfium);

    let outPages = 0;
    api.FPDFPage_New.mockImplementation(() => {
      outPages++;
      return 100 + outPages;
    });
    api.FPDF_ImportPagesByIndex.mockImplementation(() => {
      outPages++;
      return true;
    });
    api.FPDF_GetPageCount.mockImplementation(() => outPages);

    const leftDoc = PdfiumDocument.open(api, heap, new Uint8Array([1]), "");
    const rightDoc = PdfiumDocument.open(api, heap, new Uint8Array([2]), "");

    try {
      const builder = new PdfiumComparisonReportBuilder(api, heap);
      const visualDiffs = new Map<number, VisualDiffSummary>([
        [
          1,
          {
            pairIndex: 1,
            width: 400,
            height: 500,
            leftWidth: 400,
            leftHeight: 500,
            rightWidth: 400,
            rightHeight: 500,
            sizeMismatch: false,
            changedPixels: 100,
            totalPixels: 200_000,
            percentChanged: 0.05,
            regions: [
              { left: 0.2, top: 0.2, right: 0.4, bottom: 0.4, pixelCount: 100 },
            ],
          },
        ],
      ]);

      const pdf = builder.buildReport({
        summary: sampleSummary,
        leftDoc,
        rightDoc,
        visualDiffs,
      });

      expect(pdf).toBeInstanceOf(Uint8Array);
      expect(api.FPDFPage_CreateAnnot).toHaveBeenCalledWith(
        expect.any(Number),
        FPDF_ANNOT_HIGHLIGHT,
      );
      expect(api.FPDFPage_CreateAnnot).toHaveBeenCalledWith(
        expect.any(Number),
        FPDF_ANNOT_SQUARE,
      );
      expect(api.FPDFAnnot_AppendAttachmentPoints).toHaveBeenCalledTimes(2);
      expect(api.EPDFAnnot_GenerateAppearance).toHaveBeenCalledTimes(3);
      expect(api.FPDFPage_CloseAnnot).toHaveBeenCalledTimes(3);
    } finally {
      leftDoc.close();
      rightDoc.close();
    }

    expect(runtime.leaks()).toEqual([]);
  });

  it("annotates scanned added and removed pages with fallback Square banners", () => {
    const { api, runtime } = fakeComparePdfium();
    const heap = new WasmHeap(api.pdfium);

    let outPages = 0;
    api.FPDFPage_New.mockImplementation(() => ++outPages + 100);
    api.FPDF_ImportPagesByIndex.mockImplementation(() => {
      outPages++;
      return true;
    });
    api.FPDF_GetPageCount.mockImplementation(() => outPages);

    const leftDoc = PdfiumDocument.open(api, heap, new Uint8Array([1]), "");
    const rightDoc = PdfiumDocument.open(api, heap, new Uint8Array([2]), "");

    try {
      const scannedSummary: CompareSummary = {
        leftFileName: "scan-old.pdf",
        rightFileName: "scan-new.pdf",
        leftPageCount: 1,
        rightPageCount: 1,
        totalChanges: 0,
        addedWords: 0,
        removedWords: 0,
        scannedPagesCount: 2,
        pairs: [
          {
            pairIndex: 0,
            leftIndex: 0,
            rightIndex: null,
            status: "removed",
            similarity: 0,
            leftHasText: false,
            rightHasText: false,
            leftInfo: {
              box: { left: 0, bottom: 0, right: 612, top: 792 },
              rotation: 0,
            },
            rightInfo: null,
            changes: [],
          },
          {
            pairIndex: 1,
            leftIndex: null,
            rightIndex: 0,
            status: "added",
            similarity: 0,
            leftHasText: false,
            rightHasText: false,
            leftInfo: null,
            rightInfo: {
              box: { left: 0, bottom: 0, right: 612, top: 792 },
              rotation: 0,
            },
            changes: [],
          },
        ],
      };

      const builder = new PdfiumComparisonReportBuilder(api, heap);
      builder.buildReport({
        summary: scannedSummary,
        leftDoc,
        rightDoc,
        visualDiffs: new Map(),
      });

      expect(api.FPDFPage_CreateAnnot).toHaveBeenCalledTimes(2);
      expect(api.FPDFPage_CreateAnnot).toHaveBeenNthCalledWith(
        1,
        expect.any(Number),
        FPDF_ANNOT_SQUARE,
      );
      expect(api.FPDFPage_CreateAnnot).toHaveBeenNthCalledWith(
        2,
        expect.any(Number),
        FPDF_ANNOT_SQUARE,
      );
      expect(api.EPDFAnnot_GenerateAppearance).toHaveBeenCalledTimes(2);
    } finally {
      leftDoc.close();
      rightDoc.close();
    }

    expect(runtime.leaks()).toEqual([]);
  });
});
