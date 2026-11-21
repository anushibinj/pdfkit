import { describe, expect, it } from "vitest";
import { FakeRuntime } from "@/lib/pdfium/test-utils/fake-pdfium";
import { fakeOrganizePdfium } from "./fake-pdfium";

describe("fakeOrganizePdfium", () => {
  it("mocks the core and the page-tree functions with harmless successes", () => {
    const { api } = fakeOrganizePdfium();
    expect(api.FPDF_CreateNewDocument()).toBeGreaterThan(100);
    expect(api.FPDF_ImportPagesByIndex(1, 2, 3, 4, 5)).toBe(true);
    expect(api.FPDF_MovePages(1, 2, 3, 0)).toBe(true);
    expect(api.FPDFPage_SetRotation(1, 1)).toBeUndefined();
    expect(api.FPDF_ImportPagesByIndex).toHaveBeenCalledWith(1, 2, 3, 4, 5);
  });

  it("uses the runtime it is given", () => {
    const runtime = new FakeRuntime();
    expect(fakeOrganizePdfium(runtime).api.pdfium).toBe(runtime);
  });
});
