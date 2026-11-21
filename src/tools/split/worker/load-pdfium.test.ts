import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it } from "vitest";
import { asPreviewApi } from "./load-pdfium";

describe("asPreviewApi", () => {
  it("returns the module unchanged (the check happens at compile time)", () => {
    const pdfium = {} as WrappedPdfiumModule;
    expect(asPreviewApi(pdfium)).toBe(pdfium);
  });
});
