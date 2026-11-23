import { describe, expect, it, vi } from "vitest";
import { loadComparePdfium } from "./load-pdfium";

describe("loadComparePdfium", () => {
  it("loads /wasm/pdfium.js, calls PDFiumExt_Init, and returns the narrowed API", async () => {
    const fakePdfium = {
      PDFiumExt_Init: vi.fn(),
    };
    const init = vi.fn().mockResolvedValue(fakePdfium);
    const importer = vi.fn().mockResolvedValue({ init });

    const api = await loadComparePdfium("/wasm/", importer);
    expect(importer).toHaveBeenCalledWith("/wasm/pdfium.js");
    expect(init).toHaveBeenCalledTimes(1);
    const opts = init.mock.calls[0][0] as { locateFile: (p: string) => string };
    expect(opts.locateFile("pdfium.wasm")).toBe("/wasm/pdfium.wasm");
    expect(fakePdfium.PDFiumExt_Init).toHaveBeenCalledTimes(1);
    expect(api).toBe(fakePdfium);
  });
});
