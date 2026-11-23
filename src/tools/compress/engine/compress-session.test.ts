import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPRESS_OPTIONS } from "../core/options";
import { CompressSession } from "./compress-session";
import type { PdfCompressModule } from "./compress-pdf-module";
import type { PdfiumImageExtractor } from "./pdfium-image-extractor";
import type { QpdfLosslessOptimizer } from "./qpdf-optimizer";

function makeMocks() {
  const compressModule = {
    compress: vi.fn((bytes: Uint8Array) => ({
      ok: true as const,
      pdf: new Uint8Array(Math.max(10, Math.floor(bytes.length * 0.6))),
      report: JSON.stringify({
        originalBytes: bytes.length,
        compressedBytes: Math.floor(bytes.length * 0.6),
        imagesInspected: 2,
        imagesReencoded: 1,
        imagesDownsampled: 1,
        imagesDeduplicated: 0,
        imagesSkippedLarger: 0,
        flateStreamsRecompressed: 1,
        objectsRemoved: 1,
        transparencyPreserved: 0,
        notes: [],
      }),
    })),
    encodeJpeg: vi.fn(() => new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
  } as unknown as PdfCompressModule;

  const qpdfOptimizer = {
    probeAndDecryptIfNeeded: vi.fn((bytes: Uint8Array) => ({
      status: "ok" as const,
      bytes,
      wasEncrypted: false,
    })),
    optimize: vi.fn((bytes: Uint8Array) => ({
      bytes: new Uint8Array(Math.max(8, Math.floor(bytes.length * 0.9))),
    })),
  } as unknown as QpdfLosslessOptimizer;

  const imageExtractor = {
    verifyAndCountPages: vi.fn(() => ({ valid: true as const, pageCount: 3 })),
    extractCompressibleImages: vi.fn(() => []),
    buildReplacements: vi.fn(async () => []),
    renderPreviewPair: vi.fn(() => ({
      pageIndex: 0,
      pageCount: 3,
      width: 100,
      height: 150,
      originalPixels: new Uint8Array(100 * 150 * 4),
      compressedPixels: new Uint8Array(100 * 150 * 4),
    })),
  } as unknown as PdfiumImageExtractor;

  return { compressModule, qpdfOptimizer, imageExtractor };
}

describe("CompressSession", () => {
  it("rejects empty files and invalid options", async () => {
    const { compressModule, qpdfOptimizer, imageExtractor } = makeMocks();
    const session = new CompressSession(compressModule, qpdfOptimizer, imageExtractor);

    expect(await session.compress(new Uint8Array(0), DEFAULT_COMPRESS_OPTIONS)).toEqual({
      kind: "failed",
      message: "The PDF file is empty (0 bytes).",
    });
    expect(
      await session.compress(new Uint8Array(100), {
        ...DEFAULT_COMPRESS_OPTIONS,
        preset: "custom",
        dpi: 5,
      }),
    ).toMatchObject({ kind: "failed" });
  });

  it("propagates password-required outcomes from qpdf", async () => {
    const { compressModule, qpdfOptimizer, imageExtractor } = makeMocks();
    vi.mocked(qpdfOptimizer.probeAndDecryptIfNeeded).mockReturnValueOnce({
      status: "password-required",
      wrongPassword: false,
    });
    const session = new CompressSession(compressModule, qpdfOptimizer, imageExtractor);
    const out = await session.compress(new Uint8Array(100), DEFAULT_COMPRESS_OPTIONS);
    expect(out).toEqual({ kind: "password-required", wrongPassword: false });
  });

  it("compresses in balanced mode and reports size reduction", async () => {
    const { compressModule, qpdfOptimizer, imageExtractor } = makeMocks();
    const session = new CompressSession(compressModule, qpdfOptimizer, imageExtractor);
    const out = await session.compress(new Uint8Array(1000), DEFAULT_COMPRESS_OPTIONS);
    expect(out.kind).toBe("compressed");
    if (out.kind === "compressed") {
      expect(out.originalBytes).toBe(1000);
      expect(out.compressedBytes).toBeLessThan(1000);
      expect(out.pageCount).toBe(3);
    }
  });

  it("evaluates target-size mode and returns targetEvaluation", async () => {
    const { compressModule, qpdfOptimizer, imageExtractor } = makeMocks();
    const session = new CompressSession(compressModule, qpdfOptimizer, imageExtractor);
    const out = await session.compress(new Uint8Array(2000), {
      ...DEFAULT_COMPRESS_OPTIONS,
      preset: "target-size",
      targetSizeMb: 0.05,
    });
    expect(out.kind).toBe("compressed");
    if (out.kind === "compressed") {
      expect(out.targetEvaluation?.targetMet).toBe(true);
    }
  });
});
