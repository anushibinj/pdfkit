import { describe, expect, it } from "vitest";
import {
  documentDefaults,
  fakeDocumentPdfium,
  handleCounter,
  mockFunctions,
  saveDefaults,
} from "./fake-api";
import { FakeRuntime } from "./fake-runtime";

describe("handleCounter", () => {
  it("hands out distinct non-zero handles starting at 101", () => {
    const next = handleCounter();
    expect([next(), next(), next()]).toEqual([101, 102, 103]);
    // each counter is independent
    expect(handleCounter()()).toBe(101);
  });
});

describe("documentDefaults and saveDefaults", () => {
  it("report success for every call", () => {
    const next = handleCounter();
    const doc = documentDefaults(next);
    expect(doc.FPDF_LoadMemDocument(0, 0, "")).toBe(101);
    expect(doc.FPDF_GetPageCount(0)).toBe(1);
    expect(doc.FPDF_GetPageBoundingBox(0, 0)).toBe(true);
    const save = saveDefaults(next);
    expect(save.PDFiumExt_OpenFileWriter()).toBe(102);
    expect(save.PDFiumExt_SaveAsCopy(0, 0)).toBe(1);
  });
});

describe("mockFunctions", () => {
  it("wraps each default in a mock that calls it and can be overridden", () => {
    const mocks = mockFunctions({ add: (a: number, b: number) => a + b });
    expect(mocks.add(2, 3)).toBe(5);
    expect(mocks.add).toHaveBeenCalledWith(2, 3);
    mocks.add.mockReturnValue(0);
    expect(mocks.add(2, 3)).toBe(0);
  });
});

describe("fakeDocumentPdfium", () => {
  it("combines the document and save mocks on the given runtime", () => {
    const runtime = new FakeRuntime();
    const { api } = fakeDocumentPdfium(runtime);
    expect(api.pdfium).toBe(runtime);
    expect(api.FPDF_LoadPage(1, 0)).toBeGreaterThan(0);
    expect(api.PDFiumExt_SaveAsCopy(1, 2)).toBe(1);
  });
});
