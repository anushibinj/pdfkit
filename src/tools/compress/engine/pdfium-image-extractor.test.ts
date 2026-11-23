import { describe, expect, it, vi } from "vitest";
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { fakeImagesPdfium } from "@/tools/pdf-to-images/test-utils/fake-images-pdfium";
import { PdfiumImageExtractor } from "./pdfium-image-extractor";

describe("PdfiumImageExtractor", () => {
  it("reports empty, password-required, and valid documents", () => {
    const { api } = fakeImagesPdfium();
    const extractor = new PdfiumImageExtractor(api);

    expect(extractor.verifyAndCountPages(new Uint8Array(0))).toMatchObject({
      valid: false,
      reason: "corrupt",
    });

    api.FPDF_LoadMemDocument.mockReturnValueOnce(0);
    api.FPDF_GetLastError.mockReturnValueOnce(FPDF_ERR.PASSWORD);
    expect(extractor.verifyAndCountPages(new Uint8Array([1, 2, 3]))).toMatchObject({
      valid: false,
      reason: "password-required",
    });

    api.FPDF_GetPageCount.mockReturnValueOnce(4);
    expect(extractor.verifyAndCountPages(new Uint8Array([1, 2, 3]))).toEqual({
      valid: true,
      pageCount: 4,
    });
  });

  it("skips replacements in lossless mode and discards larger re-encodes", async () => {
    const { api } = fakeImagesPdfium();
    const extractor = new PdfiumImageExtractor(api);
    const sourceImages = [
      {
        rawHash: BigInt(123),
        width: 800,
        height: 600,
        drawnWidthPt: 72,
        drawnHeightPt: 54,
        rawLength: 5000,
        isJpeg: false,
        hasTransparency: false,
        pixels: { width: 800, height: 600, pixels: new Uint8Array(800 * 600 * 4) },
      },
    ];

    // Lossless -> empty
    const encodeSpy = vi.fn(async () => new Uint8Array(1000));
    expect(
      await extractor.buildReplacements(
        sourceImages,
        { lossless: true, targetDpi: 0, quality: 1, grayscale: false },
        encodeSpy,
      ),
    ).toEqual([]);
    expect(encodeSpy).not.toHaveBeenCalled();

    // Bigger re-encode -> skipped
    const bigger = vi.fn(async () => new Uint8Array(6000));
    expect(
      await extractor.buildReplacements(
        sourceImages,
        { lossless: false, targetDpi: 150, quality: 0.75, grayscale: false },
        bigger,
      ),
    ).toEqual([]);

    // Smaller re-encode -> emitted with downsampled target dimensions
    const smaller = vi.fn(async () => new Uint8Array(1200));
    const reps = await extractor.buildReplacements(
      sourceImages,
      { lossless: false, targetDpi: 150, quality: 0.75, grayscale: false },
      smaller,
    );
    expect(reps).toHaveLength(1);
    expect(reps[0].newWidth).toBe(150);
    expect(reps[0].newHeight).toBe(113);
    expect(reps[0].jpegBytes.length).toBe(1200);
  });
});
