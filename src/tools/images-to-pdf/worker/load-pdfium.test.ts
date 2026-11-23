import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it, vi } from "vitest";
import { fakeImagesToPdfPdfium } from "../test-utils/fake-pdfium";
import { asImagesToPdfPdfiumApi, loadImagesToPdfPdfium } from "./load-pdfium";

describe("load-pdfium", () => {
  it("asImagesToPdfPdfiumApi returns the module unchanged", () => {
    const { api } = fakeImagesToPdfPdfium();
    const wrapped = api as unknown as WrappedPdfiumModule;
    expect(asImagesToPdfPdfiumApi(wrapped)).toBe(wrapped);
  });

  it("loadImagesToPdfPdfium imports pdfium.js from wasmDir and initializes it", async () => {
    const { api } = fakeImagesToPdfPdfium();
    const init = vi.fn().mockResolvedValue(api);
    const importer = vi.fn().mockResolvedValue({ init });

    const loaded = await loadImagesToPdfPdfium(
      "https://example.test/wasm/",
      importer,
    );

    expect(loaded).toBe(api);
    expect(importer).toHaveBeenCalledWith("https://example.test/wasm/pdfium.js");
    expect(init).toHaveBeenCalledTimes(1);
  });
});
