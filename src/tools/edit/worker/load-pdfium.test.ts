import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it, vi } from "vitest";
import type { PdfiumGlue } from "@/lib/pdfium/load-pdfium";
import { asPdfiumApi, loadPdfium } from "./load-pdfium";

describe("asPdfiumApi", () => {
  it("returns the module unchanged (the check happens at compile time)", () => {
    const pdfium = {
      PDFiumExt_Init: vi.fn(),
    } as unknown as WrappedPdfiumModule;
    expect(asPdfiumApi(pdfium)).toBe(pdfium);
  });
});

describe("loadPdfium", () => {
  it("loads the shared module from the given directory and returns it", async () => {
    const pdfium = {
      PDFiumExt_Init: vi.fn(),
    } as unknown as WrappedPdfiumModule;
    const init = vi.fn<PdfiumGlue["init"]>(async () => pdfium);
    const importer = vi.fn(async () => ({ init }));

    const api = await loadPdfium("https://site.test/wasm/", importer);

    expect(importer).toHaveBeenCalledWith("https://site.test/wasm/pdfium.js");
    expect(pdfium.PDFiumExt_Init).toHaveBeenCalledTimes(1);
    expect(api).toBe(pdfium);
  });

  it("propagates initialisation failures", async () => {
    const glue: PdfiumGlue = {
      init: async () => {
        throw new Error("CompileError");
      },
    };
    await expect(loadPdfium("/wasm/", async () => glue)).rejects.toThrow(
      "CompileError",
    );
  });
});
