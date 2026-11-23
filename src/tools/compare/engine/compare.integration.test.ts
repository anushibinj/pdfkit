// @vitest-environment node
/**
 * Real PDFium WebAssembly integration tests for Compare PDFs.
 *
 * Verifies every acceptance criterion from Issue #22 against actual PDF bytes
 * built and inspected with `@embedpdf/pdfium`:
 * 1. Changed clause, inserted paragraph, and deleted word are highlighted with
 *    accurate glyph boxes.
 * 2. Inserting a page in the middle keeps all subsequent pages aligned without
 *    marking them changed.
 * 3. Visual mode flags a moved logo/shape that Text mode cannot detect.
 * 4. The exported Comparison Report PDF opens cleanly in PDFium, contains real
 *    Highlight annotations with QuadPoints and `/AP` appearance streams, and
 *    renders visible highlight colours on the page.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { beforeAll, describe, expect, it } from "vitest";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import {
  loadNodePdfiumModule,
  pixelAt,
} from "@/lib/pdfium/test-utils/node-pdfium";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { asComparePdfiumApi } from "../worker/load-pdfium";
import { CompareSession } from "./compare-session";
import { FPDF_ANNOT_HIGHLIGHT, type ComparePdfiumApi } from "./pdfium-api";

interface PageSpec {
  lines: { text: string; x: number; y: number }[];
  rects?: { x: number; y: number; w: number; h: number }[];
}

/**
 * Build a real multi-page PDF in memory using PDFium WASM for integration tests.
 *
 * @param full Initialised full PDFium module.
 * @param heap Memory helper bound to `full.pdfium`.
 * @param pages Page text lines and optional filled rectangles.
 * @returns Serialised PDF file bytes.
 */
function buildFixturePdf(
  full: WrappedPdfiumModule,
  heap: WasmHeap,
  pages: readonly PageSpec[],
): Uint8Array {
  const api = asComparePdfiumApi(full);
  const doc = PdfiumDocument.create(api, heap);
  try {
    pages.forEach((spec, idx) => {
      doc.withNewPage(idx, 612, 792, (page) => {
        for (const line of spec.lines) {
          const obj = api.FPDFPageObj_NewTextObj(
            doc.handle,
            "Helvetica",
            14,
          );
          heap.using(heap.utf16(line.text), (ptr) => {
            api.FPDFText_SetText(obj, ptr);
          });
          api.FPDFPageObj_SetFillColor(obj, 0, 0, 0, 255);
          api.FPDFPageObj_Transform(obj, 1, 0, 0, 1, line.x, line.y);
          api.FPDFPage_InsertObject(page, obj);
        }
        for (const rect of spec.rects ?? []) {
          const path = full.FPDFPageObj_CreateNewRect(
            rect.x,
            rect.y,
            rect.w,
            rect.h,
          );
          full.FPDFPageObj_SetFillColor(path, 20, 40, 180, 255);
          full.FPDFPath_SetDrawMode(path, 2, false);
          api.FPDFPage_InsertObject(page, path);
        }
        api.FPDFPage_GenerateContent(page);
      });
    });
    return doc.save();
  } finally {
    doc.close();
  }
}

describe("CompareSession (real PDFium WebAssembly)", () => {
  let full: WrappedPdfiumModule;
  let api: ComparePdfiumApi;
  let heap: WasmHeap;

  beforeAll(async () => {
    full = await loadNodePdfiumModule();
    api = asComparePdfiumApi(full);
    heap = new WasmHeap(api.pdfium);
  });

  it("highlights a changed clause, inserted paragraph, and deleted word, and exports a report PDF with visible Highlight annotations", () => {
    const leftPdf = buildFixturePdf(full, heap, [
      {
        lines: [
          { text: "Section 1: Total amount due is 1250 dollars.", x: 72, y: 700 },
          { text: "Section 2: Remove this legacy word immediately.", x: 72, y: 640 },
        ],
      },
    ]);

    const rightPdf = buildFixturePdf(full, heap, [
      {
        lines: [
          { text: "Section 1: Total amount due is 1520 dollars.", x: 72, y: 700 },
          { text: "Section 2: Remove this word immediately.", x: 72, y: 640 },
          { text: "Section 3: Newly inserted paragraph for compliance.", x: 72, y: 580 },
        ],
      },
    ]);

    const session = new CompareSession(api);
    try {
      session.openSide("left", "orig.pdf", leftPdf, "");
      const res = session.openSide("right", "rev.pdf", rightPdf, "");

      expect(res.summary).not.toBeNull();
      const summary = res.summary!;
      expect(summary.totalChanges).toBe(3);

      const changes = summary.pairs[0].changes;
      // 1. Changed clause ("1250" -> "1520")
      expect(changes[0].kind).toBe("modified");
      expect(changes[0].leftText).toBe("1250");
      expect(changes[0].rightText).toBe("1520");
      expect(changes[0].leftUserRects.length).toBeGreaterThan(0);
      expect(changes[0].rightUserRects.length).toBeGreaterThan(0);

      // 2. Deleted word ("legacy")
      expect(changes[1].kind).toBe("removed");
      expect(changes[1].leftText).toBe("legacy");
      expect(changes[1].leftUserRects.length).toBeGreaterThan(0);

      // 3. Inserted paragraph ("Section 3: Newly inserted paragraph for compliance.")
      expect(changes[2].kind).toBe("added");
      expect(changes[2].rightText).toContain("Newly inserted paragraph");
      expect(changes[2].rightUserRects.length).toBeGreaterThan(0);

      // 4. Build and verify exported Comparison Report PDF
      const reportBytes = session.buildReport();
      const reportDoc = PdfiumDocument.open(api, heap, reportBytes, "");
      try {
        // Cover summary page + Original page (with deletions) + Revised page (with insertions)
        expect(reportDoc.pageCount()).toBe(3);

        // Inspect Revised page (page index 2) for Highlight annotations & AP stream
        reportDoc.withPage(2, (page) => {
          const annotCount = full.FPDFPage_GetAnnotCount(page);
          expect(annotCount).toBe(2); // "1520" + inserted Section 3 paragraph

          const firstAnnot = full.FPDFPage_GetAnnot(page, 0);
          try {
            expect(full.FPDFAnnot_GetSubtype(firstAnnot)).toBe(
              FPDF_ANNOT_HIGHLIGHT,
            );
            // Mode 0 = normal appearance stream (/AP /N) needed by Acrobat
            expect(full.EPDFAnnot_HasAppearanceStream(firstAnnot, 0)).toBe(
              true,
            );
            expect(full.FPDFAnnot_CountAttachmentPoints(firstAnnot)).toBeGreaterThan(
              0,
            );
          } finally {
            full.FPDFPage_CloseAnnot(firstAnnot);
          }
        });

        // Render Revised report page and verify green highlight pixels appear on the added Section 3 line
        const rendered = reportDoc.render(2, 612, 792, 0);
        const addedBox = changes[2].rightUserRects[0];
        const sampleX = Math.round((addedBox.left + addedBox.right) / 2);
        // Convert user-space y to top-down pixel y (page height 792)
        const sampleY = Math.round(792 - (addedBox.bottom + addedBox.top) / 2);
        const [r, g, b] = pixelAt(rendered, sampleX, sampleY);
        // Highlighted pixel is visibly green-tinted (not pure white 255,255,255)
        expect(g).toBeGreaterThan(r);
        expect(g).toBeGreaterThan(b);
      } finally {
        reportDoc.close();
      }
    } finally {
      session.closeAll();
    }
  });

  it("keeps later pages aligned when a new page is inserted in the middle", () => {
    const p1 = { lines: [{ text: "Page one cover executive summary agreement", x: 72, y: 700 }] };
    const p2 = { lines: [{ text: "Page two confidentiality and non disclosure terms", x: 72, y: 700 }] };
    const p3 = { lines: [{ text: "Page three governing law jurisdiction signatures", x: 72, y: 700 }] };
    const inserted = { lines: [{ text: "Exhibit A: Brand new inserted pricing schedule", x: 72, y: 700 }] };

    const leftPdf = buildFixturePdf(full, heap, [p1, p2, p3]);
    const rightPdf = buildFixturePdf(full, heap, [p1, inserted, p2, p3]);

    const session = new CompareSession(api);
    try {
      session.openSide("left", "left.pdf", leftPdf, "");
      const res = session.openSide("right", "right.pdf", rightPdf, "");
      const pairs = res.summary!.pairs;

      expect(pairs).toHaveLength(4);
      expect(pairs[0]).toMatchObject({ leftIndex: 0, rightIndex: 0, status: "matched", changes: [] });
      expect(pairs[1]).toMatchObject({ leftIndex: null, rightIndex: 1, status: "added" });
      expect(pairs[2]).toMatchObject({ leftIndex: 1, rightIndex: 2, status: "matched", changes: [] });
      expect(pairs[3]).toMatchObject({ leftIndex: 2, rightIndex: 3, status: "matched", changes: [] });
    } finally {
      session.closeAll();
    }
  });

  it("detects a moved logo in Visual mode even when Text mode sees zero changes", () => {
    const sharedText = [{ text: "Company Header Document", x: 72, y: 700 }];
    // Left PDF has a blue logo rectangle on the left; Right PDF moves it to the right
    const leftPdf = buildFixturePdf(full, heap, [
      { lines: sharedText, rects: [{ x: 72, y: 500, w: 80, h: 80 }] },
    ]);
    const rightPdf = buildFixturePdf(full, heap, [
      { lines: sharedText, rects: [{ x: 400, y: 500, w: 80, h: 80 }] },
    ]);

    const session = new CompareSession(api);
    try {
      session.openSide("left", "logo-left.pdf", leftPdf, "");
      const res = session.openSide("right", "logo-right.pdf", rightPdf, "");

      expect(res.summary!.totalChanges).toBe(0);

      const visual = session.computeVisualDiff(0, 400);
      expect(visual.summary.changedPixels).toBeGreaterThan(500);
      expect(visual.summary.regions.length).toBeGreaterThanOrEqual(2);
    } finally {
      session.closeAll();
    }
  });
});
