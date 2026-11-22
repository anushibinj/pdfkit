import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it, vi } from "vitest";
import { loadPdfium, type PdfiumGlue } from "./load-pdfium";

describe("loadPdfium", () => {
  it("imports the glue and points Emscripten at the binary in the same directory", async () => {
    const pdfium = {
      PDFiumExt_Init: vi.fn(),
    } as unknown as WrappedPdfiumModule;
    const init = vi.fn<PdfiumGlue["init"]>(async () => pdfium);
    const importer = vi.fn(async () => ({ init }));
    const narrow = vi.fn((m: WrappedPdfiumModule) => ({ narrowed: m }));

    const api = await loadPdfium("https://site.test/wasm/", importer, narrow);

    expect(importer).toHaveBeenCalledWith("https://site.test/wasm/pdfium.js");
    const { locateFile } = init.mock.calls[0][0];
    expect(locateFile("pdfium.wasm")).toBe(
      "https://site.test/wasm/pdfium.wasm",
    );
    expect(pdfium.PDFiumExt_Init).toHaveBeenCalledTimes(1);
    expect(narrow).toHaveBeenCalledWith(pdfium);
    expect(api).toEqual({ narrowed: pdfium });
  });

  it("propagates initialisation failures", async () => {
    const glue: PdfiumGlue = {
      init: async () => {
        throw new Error("CompileError");
      },
    };
    await expect(
      loadPdfium(
        "/wasm/",
        async () => glue,
        (m) => m,
      ),
    ).rejects.toThrow("CompileError");
  });
});
