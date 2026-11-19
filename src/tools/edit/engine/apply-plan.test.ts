import { describe, expect, it, vi } from "vitest";
import type { SavePlan } from "../core/save-plan";
import { fakeMetrics } from "../test-utils/fake-metrics";
import { fakePdfium } from "../test-utils/fake-pdfium";
import { applySavePlan } from "./apply-plan";
import { PdfiumDocument } from "./pdfium-document";
import { WasmHeap } from "./wasm-heap";
import { createWriterRegistry } from "./writers/registry";

function setup(pageCount: number) {
  const { api, runtime } = fakePdfium();
  api.FPDF_GetPageCount.mockReturnValue(pageCount);
  const heap = new WasmHeap(runtime);
  const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
  const writers = createWriterRegistry(fakeMetrics);
  writers.whiteout = { write: vi.fn() };
  return { api, runtime, heap, doc, writers };
}

const whiteout = {
  id: "w",
  kind: "whiteout",
  x: 0,
  y: 0,
  rotation: 0,
  width: 5,
  height: 5,
} as const;

describe("applySavePlan", () => {
  it("skips untouched pages entirely", () => {
    const { api, heap, doc, writers } = setup(2);
    const plan: SavePlan = {
      pages: [
        { sourceIndex: 0, rotation: 0, objects: [] },
        { sourceIndex: 1, rotation: 0, objects: [] },
      ],
      images: [],
    };
    applySavePlan(doc, plan, { api, heap, writers });
    expect(api.FPDF_LoadPage).not.toHaveBeenCalled();
    expect(api.FPDFPage_Delete).not.toHaveBeenCalled();
    expect(api.FPDF_MovePages).not.toHaveBeenCalled();
  });

  it("writes objects and regenerates content only where objects were added", () => {
    const { api, heap, doc, writers } = setup(2);
    applySavePlan(
      doc,
      {
        pages: [
          { sourceIndex: 0, rotation: 1, objects: [] },
          { sourceIndex: 1, rotation: 0, objects: [whiteout] },
        ],
        images: [],
      },
      { api, heap, writers },
    );
    expect(writers.whiteout.write).toHaveBeenCalledTimes(1);
    expect(api.FPDFPage_GenerateContent).toHaveBeenCalledTimes(1);
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(2);
  });

  it("adds the user's turns to the page's own rotation", () => {
    const { api, heap, doc, writers } = setup(1);
    api.FPDFPage_GetRotation.mockReturnValue(3);
    applySavePlan(
      doc,
      { pages: [{ sourceIndex: 0, rotation: 2, objects: [] }], images: [] },
      { api, heap, writers },
    );
    expect(api.FPDFPage_SetRotation).toHaveBeenCalledWith(
      expect.any(Number),
      1,
    );
  });

  it("fails when PDFium cannot regenerate the page", () => {
    const { api, heap, doc, writers } = setup(1);
    api.FPDFPage_GenerateContent.mockReturnValue(false);
    expect(() =>
      applySavePlan(
        doc,
        {
          pages: [{ sourceIndex: 0, rotation: 0, objects: [whiteout] }],
          images: [],
        },
        { api, heap, writers },
      ),
    ).toThrow("save the page content");
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(1);
  });

  it("deletes highest first, then moves the rest in one call", () => {
    const { api, runtime, heap, doc, writers } = setup(4);
    applySavePlan(
      doc,
      {
        pages: [
          { sourceIndex: 3, rotation: 0, objects: [] },
          { sourceIndex: 0, rotation: 0, objects: [] },
        ],
        images: [],
      },
      { api, heap, writers },
    );
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
    const { api, heap, doc, writers } = setup(2);
    api.FPDF_MovePages.mockReturnValue(false);
    expect(() =>
      applySavePlan(
        doc,
        {
          pages: [1, 0].map((i) => ({
            sourceIndex: i,
            rotation: 0 as const,
            objects: [],
          })),
          images: [],
        },
        { api, heap, writers },
      ),
    ).toThrow("reorder the pages");
  });
});
