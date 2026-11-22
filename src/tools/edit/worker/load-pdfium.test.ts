import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it, vi } from "vitest";
import { asPdfiumApi } from "./load-pdfium";

describe("asPdfiumApi", () => {
  it("returns the module unchanged (the check happens at compile time)", () => {
    const pdfium = {
      PDFiumExt_Init: vi.fn(),
    } as unknown as WrappedPdfiumModule;
    expect(asPdfiumApi(pdfium)).toBe(pdfium);
  });
});
