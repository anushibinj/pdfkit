import { describe, expect, it, vi } from "vitest";
import type { SavePage, SavePlan } from "../core/save-plan";
import { fakeMetrics } from "../test-utils/fake-metrics";
import { fakePdfium } from "../test-utils/fake-pdfium";
import { applySavePlan } from "./apply-plan";
import { PdfiumDocument } from "@/lib/pdfium/document";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { createWriterRegistry } from "./writers/registry";

function setup(pageCount: number) {
  const { api, runtime } = fakePdfium();
  api.FPDF_GetPageCount.mockReturnValue(pageCount);
  const heap = new WasmHeap(runtime);
  const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
  const writers = createWriterRegistry(fakeMetrics);
  writers.highlight = { write: vi.fn() };
  const deps = { api, heap, writers, metrics: fakeMetrics };
  return { api, runtime, heap, doc, writers, deps };
}

const highlight = {
  id: "h",
  kind: "highlight",
  x: 0,
  y: 0,
  rotation: 0,
  width: 5,
  height: 5,
  color: { r: 255, g: 255, b: 0 },
} as const;

/** A plan page with no changes unless overridden. */
const page = (
  sourceIndex: number,
  extra: Partial<SavePage> = {},
): SavePage => ({
  sourceIndex,
  rotation: 0,
  objects: [],
  textEdits: [],
  ...extra,
});

describe("applySavePlan", () => {
  it("skips untouched pages entirely", () => {
    const { api, doc, deps } = setup(2);
    const plan: SavePlan = { pages: [page(0), page(1)], images: [] };
    applySavePlan(doc, plan, deps);
    expect(api.FPDF_LoadPage).not.toHaveBeenCalled();
    expect(api.FPDFPage_Delete).not.toHaveBeenCalled();
    expect(api.FPDF_MovePages).not.toHaveBeenCalled();
  });

  it("writes objects and regenerates content only where objects were added", () => {
    const { api, doc, writers, deps } = setup(2);
    applySavePlan(
      doc,
      {
        pages: [page(0, { rotation: 1 }), page(1, { objects: [highlight] })],
        images: [],
      },
      deps,
    );
    expect(writers.highlight.write).toHaveBeenCalledTimes(1);
    expect(api.FPDFPage_GenerateContent).toHaveBeenCalledTimes(1);
    expect(api.FPDFText_LoadPage).not.toHaveBeenCalled();
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(2);
  });

  it("edits existing text before adding objects, then regenerates once", () => {
    const { api, doc, writers, deps } = setup(1);
    const order: string[] = [];
    api.FPDFText_LoadPage.mockImplementation(() => {
      order.push("read text");
      return 55;
    });
    vi.mocked(writers.highlight.write).mockImplementation(() => {
      order.push("write object");
    });
    api.FPDFPage_GenerateContent.mockImplementation(() => {
      order.push("generate");
      return true;
    });
    applySavePlan(
      doc,
      {
        pages: [
          page(0, {
            objects: [highlight],
            textEdits: [{ runId: "0", text: "New" }],
          }),
        ],
        images: [],
      },
      deps,
    );
    expect(order).toEqual(["read text", "write object", "generate"]);
  });

  it("regenerates a page that only has text edits", () => {
    const { api, doc, deps } = setup(1);
    applySavePlan(
      doc,
      {
        pages: [page(0, { textEdits: [{ runId: "0", text: "New" }] })],
        images: [],
      },
      deps,
    );
    expect(api.FPDFPage_GenerateContent).toHaveBeenCalledTimes(1);
  });

  it("adds the user's turns to the page's own rotation", () => {
    const { api, doc, deps } = setup(1);
    api.FPDFPage_GetRotation.mockReturnValue(3);
    applySavePlan(doc, { pages: [page(0, { rotation: 2 })], images: [] }, deps);
    expect(api.FPDFPage_SetRotation).toHaveBeenCalledWith(
      expect.any(Number),
      1,
    );
  });

  it("fails when PDFium cannot regenerate the page", () => {
    const { api, doc, deps } = setup(1);
    api.FPDFPage_GenerateContent.mockReturnValue(false);
    expect(() =>
      applySavePlan(
        doc,
        { pages: [page(0, { objects: [highlight] })], images: [] },
        deps,
      ),
    ).toThrow("save the page content");
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(1);
  });

  it("deletes highest first, then moves the rest in one call", () => {
    const { api, runtime, doc, deps } = setup(4);
    applySavePlan(doc, { pages: [page(3), page(0)], images: [] }, deps);
    expect(api.FPDFPage_Delete.mock.calls.map((c) => c[1])).toEqual([2, 1]);
    const [, indices, count, dest] = api.FPDF_MovePages.mock.calls[0];
    expect([
      runtime.getValue(indices),
      runtime.getValue(indices + 4),
      count,
      dest,
    ]).toEqual([1, 0, 2, 0]);
    doc.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("fails when PDFium cannot reorder", () => {
    const { api, doc, deps } = setup(2);
    api.FPDF_MovePages.mockReturnValue(false);
    expect(() =>
      applySavePlan(doc, { pages: [page(1), page(0)], images: [] }, deps),
    ).toThrow("reorder the pages");
  });
});
