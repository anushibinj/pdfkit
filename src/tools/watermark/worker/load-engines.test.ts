import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { describe, expect, it, vi } from "vitest";
import type { PdfiumGlue } from "@/lib/pdfium/load-pdfium";
import type { QpdfGlue, QpdfModule } from "@/lib/qpdf/qpdf-module";
import type { QpdfEngine } from "@/lib/qpdf/qpdf-runner";
import { fakeWatermarkPdfium } from "../test-utils/fake-pdfium";
import { WatermarkSession } from "../engine/watermark-session";
import {
  asWatermarkPdfiumApi,
  engineLoaders,
  loadWatermarkSession,
} from "./load-engines";

describe("asWatermarkPdfiumApi", () => {
  it("returns the module unchanged (the check happens at compile time)", () => {
    const pdfium = {} as WrappedPdfiumModule;
    expect(asWatermarkPdfiumApi(pdfium)).toBe(pdfium);
  });
});

describe("engineLoaders", () => {
  it("loads both glue files from the same directory", async () => {
    const pdfium = {
      PDFiumExt_Init: vi.fn(),
    } as unknown as WrappedPdfiumModule;
    const program = { FS: {}, callMain: () => 0 } as unknown as QpdfModule;
    const pdfiumGlue: PdfiumGlue = { init: async () => pdfium };
    const qpdfGlue: QpdfGlue = {
      default: (options) =>
        new Promise((resolve) =>
          options.instantiateWasm({}, () => resolve(program)),
        ),
    };
    const importer = vi.fn(async (url: string) =>
      url.endsWith("pdfium.js") ? pdfiumGlue : qpdfGlue,
    );
    const loaders = engineLoaders(
      "https://site.test/wasm/",
      importer,
      async () => ({}) as WebAssembly.Instance,
      { log: () => {}, warn: () => {} },
    );
    expect(await loaders.pdfium()).toBe(pdfium);
    expect(await loaders.qpdf()).toBeDefined();
    expect(importer.mock.calls.map(([url]) => url)).toEqual([
      "https://site.test/wasm/pdfium.js",
      "https://site.test/wasm/qpdf.mjs",
    ]);
  });
});

describe("loadWatermarkSession", () => {
  it("loads both engines and builds a session", async () => {
    const { api } = fakeWatermarkPdfium();
    const session = await loadWatermarkSession({
      pdfium: async () => api as unknown as WrappedPdfiumModule,
      qpdf: async () => ({}) as QpdfEngine,
    });
    expect(session).toBeInstanceOf(WatermarkSession);
  });

  it("fails when either engine fails", async () => {
    await expect(
      loadWatermarkSession({
        pdfium: async () => {
          throw new Error("CompileError");
        },
        qpdf: async () => ({}) as QpdfEngine,
      }),
    ).rejects.toThrow("CompileError");
  });
});
