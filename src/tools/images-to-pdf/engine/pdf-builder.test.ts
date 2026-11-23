import { describe, expect, it, vi } from "vitest";
import { fakeImagesToPdfPdfium } from "../test-utils/fake-pdfium";
import { InvalidImageError, type ImageEmbedder } from "./image-embedder";
import { ImagesToPdfBuilder, type ImageSource } from "./pdf-builder";
import type { PageLayoutCalculator } from "../core/layout";

const samplePng: ImageSource = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mime: "image/png",
  width: 400,
  height: 200,
  rotation: 0,
};

const sampleJpeg: ImageSource = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  mime: "image/jpeg",
  width: 300,
  height: 600,
  rotation: 1,
};

describe("ImagesToPdfBuilder", () => {
  it("throws when given an empty image list", () => {
    const { api } = fakeImagesToPdfPdfium();
    const builder = new ImagesToPdfBuilder(api);
    expect(() => builder.build([], undefined)).toThrow(
      /at least one image/i,
    );
    expect(api.FPDF_CreateNewDocument).not.toHaveBeenCalled();
  });

  it("builds one page per image in order, reports progress, and cleans up WASM resources", () => {
    const { api, runtime } = fakeImagesToPdfPdfium();
    const builder = new ImagesToPdfBuilder(api);
    const progress = vi.fn();

    const result = builder.build(
      [samplePng, sampleJpeg],
      { pageSize: "fit", orientation: "auto", marginMm: 0, scaleMode: "contain" },
      progress,
    );

    expect(result.pageCount).toBe(2);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(api.FPDF_CreateNewDocument).toHaveBeenCalledTimes(1);
    expect(api.FPDFPage_New).toHaveBeenCalledTimes(2);
    expect(api.FPDFPage_New).toHaveBeenNthCalledWith(1, expect.any(Number), 0, 400, 200);
    // Second image is 300 x 600 rotated 90° CW -> effective 600 x 300.
    expect(api.FPDFPage_New).toHaveBeenNthCalledWith(2, expect.any(Number), 1, 600, 300);
    expect(api.EPDFImageObj_SetPng).toHaveBeenCalledTimes(1);
    expect(api.EPDFImageObj_SetJpeg).toHaveBeenCalledTimes(1);
    expect(api.FPDFPage_InsertObject).toHaveBeenCalledTimes(2);
    expect(api.FPDFPage_GenerateContent).toHaveBeenCalledTimes(2);
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(2);
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);

    expect(progress).toHaveBeenCalledWith(0.45, "Added image 1 of 2…");
    expect(progress).toHaveBeenCalledWith(0.9, "Added image 2 of 2…");
    expect(progress).toHaveBeenCalledWith(0.95, "Saving PDF…");
    expect(progress).toHaveBeenCalledWith(1, "Done");
  });

  it("tags InvalidImageError with the failing imageIndex and still closes page and document", () => {
    const { api, runtime } = fakeImagesToPdfPdfium();
    api.EPDFImageObj_SetJpeg.mockReturnValue(false);
    const builder = new ImagesToPdfBuilder(api);

    let caught: unknown;
    try {
      builder.build([samplePng, sampleJpeg], undefined);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(InvalidImageError);
    expect((caught as InvalidImageError).imageIndex).toBe(1);
    // Uninserted image object must be destroyed, page and doc must be closed.
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledTimes(1);
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(2);
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
  });

  it("respects injected ImageEmbedder and PageLayoutCalculator collaborators (DIP)", () => {
    const { api } = fakeImagesToPdfPdfium();
    const embedder: ImageEmbedder = {
      embed: vi.fn(() => ({ width: 50, height: 50 })),
    };
    const layout: PageLayoutCalculator = {
      compute: vi.fn(() => ({
        pageWidth: 500,
        pageHeight: 700,
        drawnWidth: 400,
        drawnHeight: 300,
        matrix: [400, 0, 0, 300, 50, 200] as const,
      })),
    };

    const builder = new ImagesToPdfBuilder(api, embedder, layout);
    builder.build([samplePng], undefined);

    expect(layout.compute).toHaveBeenCalledTimes(1);
    expect(embedder.embed).toHaveBeenCalledTimes(1);
    expect(api.FPDFPage_New).toHaveBeenCalledWith(expect.any(Number), 0, 500, 700);
    expect(api.FPDFPageObj_Transform).toHaveBeenCalledWith(
      expect.any(Number),
      400,
      0,
      0,
      300,
      50,
      200,
    );
  });

  it("throws when FPDFPage_GenerateContent returns false", () => {
    const { api } = fakeImagesToPdfPdfium();
    api.FPDFPage_GenerateContent.mockReturnValue(false);
    const builder = new ImagesToPdfBuilder(api);

    expect(() => builder.build([samplePng], undefined)).toThrow(
      /write page 1/i,
    );
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
  });
});
