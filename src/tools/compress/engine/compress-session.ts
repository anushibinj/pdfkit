/**
 * High-level PDF compression orchestrator coordinating `qpdf`, `pdf-compress.wasm`,
 * `PDFium` image extraction/rendering, and the `TargetSizeSolver`.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Coordinates the multi-stage compression pipeline.
 * - Open/Closed: New presets or encoding backends can be plugged in via interfaces.
 * - Dependency Inversion: Depends on `QpdfLosslessOptimizer`, `PdfCompressModule`,
 *   `PdfiumImageExtractor`, and an injectable `JpegEncodeFn`.
 */

import type {
  CompressOutcome,
  CompressOptions,
  CompressReport,
  ResolvedPassConfig,
} from "../core/model";
import {
  mbToBytes,
  resolvePresetConfig,
  serializeCompressPlan,
  validateCompressOptions,
} from "../core/options";
import { parseCompressReport } from "../core/report";
import { TargetSizeSolver } from "../core/target-size-solver";
import type { PdfCompressModule } from "./compress-pdf-module";
import type {
  ExtractedSourceImage,
  JpegEncodeFn,
  PdfiumImageExtractor,
  PreviewPairResult,
} from "./pdfium-image-extractor";
import type { QpdfLosslessOptimizer } from "./qpdf-optimizer";

/** Progress reporting callback invoked across compression stages. */
export type ProgressCallback = (fraction: number, stage: string) => void;

/**
 * Coordinates decryption, image extraction, Rust/qpdf compression passes,
 * target-size search, non-expansion checks, and side-by-side preview rendering.
 */
export class CompressSession {
  private readonly solver = new TargetSizeSolver();

  /**
   * @param compressModule `pdf-compress.wasm` bridge.
   * @param qpdfOptimizer `qpdf` lossless optimizer & decryptor.
   * @param imageExtractor `PDFium` image extractor & preview renderer.
   * @param encodeJpeg Optional custom JPEG encoder (defaults to `compressModule.encodeJpeg`;
   *   browser worker injects `OffscreenCanvas` with Rust fallback).
   */
  constructor(
    private readonly compressModule: PdfCompressModule,
    private readonly qpdfOptimizer: QpdfLosslessOptimizer,
    private readonly imageExtractor: PdfiumImageExtractor,
    private readonly encodeJpeg?: JpegEncodeFn,
  ) {}

  /**
   * Compresses `bytes` according to `options`.
   *
   * Pipeline:
   * 1. Validates options and input buffer.
   * 2. Probes encryption / decrypts via `qpdf` (`password-required` on missing/wrong password).
   * 3. Verifies readable pages via `PDFium`.
   * 4. In lossy or target-size mode, extracts opaque source images once via `PDFium`.
   * 5. Executes either a single pass (`lossless`, `balanced`, `small`, `custom`) or
   *    iterative quality ladder (`target-size`), each time running:
   *    a) JPEG replacement encoding (keeping original whenever re-encode is bigger)
   *    b) `pdf-compress.wasm` (dedup, Flate-9, image swap, object pruning)
   *    c) `qpdf` lossless pass (`--object-streams=generate --recompress-flate --compression-level=9 --remove-unreferenced-resources=yes`)
   *    d) Strict non-expansion guard (`finalBytes <= originalBytes`)
   *
   * @param bytes Raw input PDF bytes.
   * @param options User compression options.
   * @param password Optional open password.
   * @param onProgress Optional progress callback.
   * @returns Detailed {@link CompressOutcome}.
   */
  async compress(
    bytes: Uint8Array,
    options: CompressOptions,
    password = "",
    onProgress: ProgressCallback = () => {},
  ): Promise<CompressOutcome> {
    if (bytes.length === 0) {
      return { kind: "failed", message: "The PDF file is empty (0 bytes)." };
    }

    const validationError = validateCompressOptions(options);
    if (validationError) {
      return { kind: "failed", message: validationError };
    }

    onProgress(0.08, "Checking PDF structure…");
    const prep = this.qpdfOptimizer.probeAndDecryptIfNeeded(bytes, password);
    if (prep.status === "password-required") {
      return {
        kind: "password-required",
        wrongPassword: prep.wrongPassword,
      };
    }
    if (prep.status === "unreadable") {
      return { kind: "failed", message: prep.message };
    }

    const workingBytes = prep.bytes;
    const verification = this.imageExtractor.verifyAndCountPages(workingBytes, "");
    if (!verification.valid) {
      if (verification.reason === "password-required") {
        return { kind: "password-required", wrongPassword: Boolean(password) };
      }
      return { kind: "failed", message: verification.message };
    }

    const pageCount = verification.pageCount;
    const originalBytes = bytes.length;
    const encoder = this.getJpegEncoder();

    // Extract opaque source images only once when lossy passes may run.
    let extractedImages: ExtractedSourceImage[] = [];
    if (options.preset !== "lossless") {
      onProgress(0.22, "Inspecting embedded images…");
      extractedImages = this.imageExtractor.extractCompressibleImages(workingBytes, "");
    }

    if (options.preset === "target-size") {
      const targetBytes = mbToBytes(options.targetSizeMb);
      const solved = await this.solver.solve(
        targetBytes,
        options.grayscale,
        async (stepConfig, stepIndex, totalSteps) => {
          const frac = 0.3 + ((stepIndex + 1) / totalSteps) * 0.65;
          onProgress(
            frac,
            stepConfig.lossless
              ? "Trying lossless compression…"
              : `Testing ${stepConfig.targetDpi} DPI / ${Math.round(stepConfig.quality * 100)}% quality…`,
          );
          return this.runSinglePass(
            originalBytes,
            workingBytes,
            stepConfig,
            extractedImages,
            encoder,
          );
        },
      );

      onProgress(1.0, "Finished");
      return {
        kind: "compressed",
        pdf: solved.pdf,
        pageCount,
        originalBytes,
        compressedBytes: solved.pdf.length,
        report: solved.report,
        appliedConfig: solved.evaluation.appliedConfig,
        targetEvaluation: solved.evaluation,
      };
    }

    const config = resolvePresetConfig(options);
    onProgress(0.55, "Compressing streams and images…");
    const single = await this.runSinglePass(
      originalBytes,
      workingBytes,
      config,
      extractedImages,
      encoder,
    );

    onProgress(1.0, "Finished");
    return {
      kind: "compressed",
      pdf: single.pdf,
      pageCount,
      originalBytes,
      compressedBytes: single.pdf.length,
      report: single.report,
      appliedConfig: config,
      warnings: single.warnings,
    };
  }

  /**
   * Renders a matched pair of original vs compressed page bitmaps for visual inspection.
   *
   * @param originalBytes Original PDF bytes.
   * @param compressedBytes Compressed PDF bytes.
   * @param pageIndex Zero-based page index.
   * @param width Target canvas width in pixels.
   * @param password Optional open password for the original PDF.
   * @returns {@link PreviewPairResult}.
   */
  renderPreview(
    originalBytes: Uint8Array,
    compressedBytes: Uint8Array,
    pageIndex: number,
    width: number,
    password = "",
  ): PreviewPairResult {
    return this.imageExtractor.renderPreviewPair(
      originalBytes,
      compressedBytes,
      pageIndex,
      width,
      password,
    );
  }

  /**
   * Executes one compression pass (`replacements -> pdf-compress.wasm -> qpdf lossless -> non-expansion`).
   */
  private async runSinglePass(
    originalInputBytes: number,
    workingBytes: Uint8Array,
    config: ResolvedPassConfig,
    extractedImages: readonly ExtractedSourceImage[],
    encoder: JpegEncodeFn,
  ): Promise<{ pdf: Uint8Array; report: CompressReport; warnings?: string }> {
    const replacements = await this.imageExtractor.buildReplacements(
      extractedImages,
      config,
      encoder,
    );
    const planBytes = serializeCompressPlan(config, replacements);

    const wasmOut = this.compressModule.compress(workingBytes, planBytes);
    if (!wasmOut.ok) {
      throw new Error(wasmOut.message);
    }

    const report = parseCompressReport(
      wasmOut.report,
      originalInputBytes,
      wasmOut.pdf.length,
    );

    // Run qpdf structural pass (object streams + Flate level 9 + unreferenced resource removal)
    let bestBytes = wasmOut.pdf;
    let warnings: string | undefined;
    const qpdfOut = this.qpdfOptimizer.optimize(bestBytes);
    if (qpdfOut && qpdfOut.bytes.length < bestBytes.length) {
      bestBytes = qpdfOut.bytes;
      warnings = qpdfOut.warnings;
    }

    // Strict non-expansion guard against the raw uploaded input size
    if (bestBytes.length > originalInputBytes) {
      // Also evaluate qpdf directly on workingBytes in case lopdf serialization added overhead
      const directQpdf = this.qpdfOptimizer.optimize(workingBytes);
      if (directQpdf && directQpdf.bytes.length < originalInputBytes) {
        bestBytes = directQpdf.bytes;
        warnings = directQpdf.warnings;
      } else {
        bestBytes = workingBytes.length <= originalInputBytes ? workingBytes : bestBytes;
      }
    }

    report.originalBytes = originalInputBytes;
    report.compressedBytes = bestBytes.length;

    return { pdf: bestBytes, report, warnings };
  }

  /** Returns the injected JPEG encoder or wraps `compressModule.encodeJpeg`. */
  private getJpegEncoder(): JpegEncodeFn {
    if (this.encodeJpeg) return this.encodeJpeg;
    return async (image, targetWidth, targetHeight, quality, grayscale) =>
      this.compressModule.encodeJpeg(
        image.pixels,
        image.width,
        image.height,
        targetWidth,
        targetHeight,
        quality,
        grayscale,
      );
  }
}
