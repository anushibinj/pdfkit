import { describe, expect, it } from "vitest";
import {
  FakeRuntime,
  coreDefaults,
  fakePdfiumCore,
  handleCounter,
  mockApi,
} from "./fake-pdfium";

describe("handleCounter", () => {
  it("counts up from the value after the start (101 by default)", () => {
    const next = handleCounter();
    expect([next(), next(), next()]).toEqual([101, 102, 103]);
    expect(handleCounter(5)()).toBe(6);
  });
});

describe("coreDefaults", () => {
  it("returns success values and draws handles from the shared counter", () => {
    const defaults = coreDefaults(handleCounter(10));
    expect(defaults.FPDF_LoadMemDocument(0, 0, "")).toBe(11);
    expect(defaults.FPDF_CreateNewDocument()).toBe(12);
    expect(defaults.FPDF_GetPageBoundingBox(1, 2)).toBe(true);
    expect(defaults.FPDF_GetPageCount(1)).toBe(1);
  });
});

describe("mockApi", () => {
  it("wraps every default in a mock and attaches the runtime", () => {
    const runtime = new FakeRuntime();
    const api = mockApi(coreDefaults(handleCounter()), runtime);
    expect(api.FPDF_LoadPage(1, 0)).toBe(101);
    expect(api.FPDF_LoadPage).toHaveBeenCalledWith(1, 0);
    api.FPDF_LoadPage.mockReturnValue(0);
    expect(api.FPDF_LoadPage(1, 0)).toBe(0);
    expect(api.pdfium).toBe(runtime);
  });
});

describe("fakePdfiumCore", () => {
  it("returns a mocked core API sharing its runtime", () => {
    const { api, runtime } = fakePdfiumCore();
    expect(api.pdfium).toBe(runtime);
    expect(api.FPDF_CreateNewDocument()).toBeGreaterThan(0);
  });
});
