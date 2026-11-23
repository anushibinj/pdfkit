import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OCR_OPTIONS } from "../core/options";
import { OcrSession } from "./ocr-session";
import type { OcrPageProcessor } from "./pdfium-page-processor";
import type { OverlayApplier } from "./qpdf-overlay-applier";
import type { OcrRecognizer } from "./tesseract-recognizer";

function createMocks() {
  const helper = {
    preprocessBmp: vi.fn(() => new Uint8Array([66, 77])),
    normalizeOverlay: vi.fn((b: Uint8Array) => b),
    buildTextLayer: vi.fn(() => new Uint8Array([37, 80, 68, 70])),
  };

  const pageProcessor: OcrPageProcessor = {
    ensurePdfBytes: vi.fn((bytes: Uint8Array) => ({
      pdfBytes: bytes,
      wasImageInput: false,
    })),
    inspectPages: vi.fn(() => [
      {
        pageIndex: 0,
        placementSize: { width: 612, height: 792 },
        existingText: "Existing text",
        hasExistingText: true,
      },
      {
        pageIndex: 1,
        placementSize: { width: 612, height: 792 },
        existingText: "",
        hasExistingText: false,
      },
    ]),
    renderPageForOcr: vi.fn(() => ({
      pixels: new Uint8Array(16),
      width: 2,
      height: 2,
      effectiveDpiX: 300,
      effectiveDpiY: 300,
      placementSize: { width: 612, height: 792 },
    })),
  };

  const recognizer: OcrRecognizer = {
    recognizePage: vi.fn(async () => ({
      text: "Scanned word",
      tsv: "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t92\tScanned",
      confidence: 92,
      pdfOverlay: new Uint8Array([37, 80, 68, 70, 49]),
    })),
  };

  const overlayApplier: OverlayApplier = {
    probePdf: vi.fn(() => ({ status: "ready" as const })),
    applyOverlays: vi.fn(() => new Uint8Array([37, 80, 68, 70, 50])),
  };

  return { helper, pageProcessor, recognizer, overlayApplier };
}

describe("OcrSession", () => {
  it("skips existing-text pages by default and overlays recognized scanned pages", async () => {
    const { helper, pageProcessor, recognizer, overlayApplier } = createMocks();
    const session = new OcrSession(
      helper,
      pageProcessor,
      recognizer,
      overlayApplier,
    );

    const out = await session.run(new Uint8Array([1, 2, 3]), DEFAULT_OCR_OPTIONS);
    expect(out.kind).toBe("completed");
    if (out.kind === "completed") {
      expect(out.report.ocrPagesCount).toBe(1);
      expect(out.report.skippedPagesCount).toBe(1);
      expect(out.report.fullText).toContain("Existing text");
      expect(out.report.fullText).toContain("Scanned word");
      expect(recognizer.recognizePage).toHaveBeenCalledTimes(1);
      expect(helper.normalizeOverlay).toHaveBeenCalledTimes(1);
      expect(overlayApplier.applyOverlays).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "",
        [{ pageIndex: 1, overlayPdf: new Uint8Array([37, 80, 68, 70, 49]) }],
      );
    }
  });

  it("re-runs OCR on pages with existing text when redoExistingText is true", async () => {
    const { helper, pageProcessor, recognizer, overlayApplier } = createMocks();
    const session = new OcrSession(
      helper,
      pageProcessor,
      recognizer,
      overlayApplier,
    );

    const out = await session.run(new Uint8Array([1, 2, 3]), {
      ...DEFAULT_OCR_OPTIONS,
      redoExistingText: true,
    });
    expect(out.kind).toBe("completed");
    if (out.kind === "completed") {
      expect(out.report.ocrPagesCount).toBe(2);
      expect(out.report.skippedPagesCount).toBe(0);
      expect(recognizer.recognizePage).toHaveBeenCalledTimes(2);
    }
  });

  it("falls back to buildTextLayer when TessPDFRenderer yields null", async () => {
    const { helper, pageProcessor, recognizer, overlayApplier } = createMocks();
    vi.mocked(recognizer.recognizePage).mockResolvedValueOnce({
      text: "Fallback",
      tsv: "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t88\tFallback",
      confidence: 88,
      pdfOverlay: null,
    });

    const session = new OcrSession(
      helper,
      pageProcessor,
      recognizer,
      overlayApplier,
    );
    const out = await session.run(new Uint8Array([1]), DEFAULT_OCR_OPTIONS);
    expect(out.kind).toBe("completed");
    expect(helper.buildTextLayer).toHaveBeenCalledTimes(1);
  });

  it("falls back to buildTextLayer when normalizeOverlay throws", async () => {
    const { helper, pageProcessor, recognizer, overlayApplier } = createMocks();
    helper.normalizeOverlay.mockImplementationOnce(() => {
      throw new Error("Malformed overlay PDF");
    });

    const session = new OcrSession(
      helper,
      pageProcessor,
      recognizer,
      overlayApplier,
    );
    const out = await session.run(new Uint8Array([1]), DEFAULT_OCR_OPTIONS);
    expect(out.kind).toBe("completed");
    expect(helper.normalizeOverlay).toHaveBeenCalledTimes(1);
    expect(helper.buildTextLayer).toHaveBeenCalledTimes(1);
  });

  it("handles password-required, empty input, and cancellation cleanly", async () => {
    const { helper, pageProcessor, recognizer, overlayApplier } = createMocks();
    const session = new OcrSession(
      helper,
      pageProcessor,
      recognizer,
      overlayApplier,
    );

    expect(await session.run(new Uint8Array(0), DEFAULT_OCR_OPTIONS)).toEqual({
      kind: "failed",
      message: "The file is empty (0 bytes).",
    });

    vi.mocked(overlayApplier.probePdf).mockReturnValueOnce({
      status: "password-required",
      wrongPassword: false,
    });
    expect(await session.run(new Uint8Array([1]), DEFAULT_OCR_OPTIONS)).toEqual({
      kind: "password-required",
      wrongPassword: false,
    });

    expect(
      await session.run(new Uint8Array([1]), DEFAULT_OCR_OPTIONS, "", () => {}, {
        cancelled: true,
      }),
    ).toEqual({ kind: "cancelled" });
  });
});
