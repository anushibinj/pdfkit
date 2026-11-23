import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it } from "vitest";
import { asOrganizeApi } from "./load-pdfium";

describe("asOrganizeApi", () => {
  it("returns the module itself (the check is at compile time)", () => {
    const pdfium = { FPDF_ImportPagesByIndex: () => true };
    expect(asOrganizeApi(pdfium as unknown as WrappedPdfiumModule)).toBe(
      pdfium,
    );
  });
});
