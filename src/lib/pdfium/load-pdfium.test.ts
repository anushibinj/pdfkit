import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it, vi } from "vitest";
import { loadPdfiumModule, type PdfiumGlue } from "./load-pdfium";

describe("loadPdfiumModule", () => {
  it("imports the glue, points Emscripten at the binary next to it and initialises once", async () => {
    const pdfium = {
      PDFiumExt_Init: vi.fn(),
    } as unknown as WrappedPdfiumModule;
    const init = vi.fn<PdfiumGlue["init"]>(async () => pdfium);
    const importer = vi.fn(async () => ({ init }));

    const loaded = await loadPdfiumModule("https://site.test/wasm/", importer);

    expect(importer).toHaveBeenCalledWith("https://site.test/wasm/pdfium.js");
    const { locateFile } = init.mock.calls[0][0];
    expect(locateFile("pdfium.wasm")).toBe(
      "https://site.test/wasm/pdfium.wasm",
    );
    expect(pdfium.PDFiumExt_Init).toHaveBeenCalledTimes(1);
    expect(loaded).toBe(pdfium);
  });

  it("propagates import and initialisation failures", async () => {
    await expect(
      loadPdfiumModule("/wasm/", async () => {
        throw new Error("Failed to fetch");
      }),
    ).rejects.toThrow("Failed to fetch");
    const glue: PdfiumGlue = {
      init: async () => {
        throw new Error("CompileError");
      },
    };
    await expect(loadPdfiumModule("/wasm/", async () => glue)).rejects.toThrow(
      "CompileError",
    );
  });
});
