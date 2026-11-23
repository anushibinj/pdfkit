/**
 * High-level OCR orchestrator coordinating PDFium page inspection/rendering,
 * Rust `pdf-ocr.wasm` BMP preprocessing & overlay normalization, Tesseract WASM
 * recognition, and `qpdf --overlay` composition.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Coordinates the multi-stage OCR pipeline and progress tracking.
 * - Dependency Inversion: Depends solely on injected abstractions (`OcrPageProcessor`,
 *   `OcrRecognizer`, `OverlayApplier`, `OcrHelperModule`), making every branch testable
 *   in isolation without real WebAssembly modules.
 */

import { errorMessage } from "@/lib/errors";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import type { OcrOptions, OcrOutcome, OcrPageResult } from "../core/model";
import { normalizeOcrOptions, validateOcrOptions } from "../core/options";
import { buildOcrReport, countWords } from "../core/report";
import type { OcrHelperModule } from "./pdf-ocr-module";
import type { OcrPageProcessor } from "./pdfium-page-processor";
import type { OverlayApplier, PageOverlayEntry } from "./qpdf-overlay-applier";
import type { OcrRecognizer } from "./tesseract-recognizer";

/** Progress reporting callback invoked across OCR stages and pages. */
export type OcrProgressCallback = (fraction: number, stage: string) => void;

/** Cooperative cancellation token checked between heavy page operations. */
export interface OcrCancelToken {
  readonly cancelled: boolean;
}

/**
 * Coordinates image-to-PDF conversion, encryption probing, existing-text skipping,
 * high-DPI page rendering, Tesseract recognition, and `qpdf --overlay` assembly.
 */
export class OcrSession {
  /**
   * @param helper `pdf-ocr.wasm` helper module (BMP encoding, overlay normalization, fallback text layer).
   * @param pageProcessor `PDFium` page inspector & rasterizer.
   * @param recognizer `Tesseract` WebAssembly recognizer.
   * @param overlayApplier `qpdf` encryption probe & `--overlay` applier.
   */
  constructor(
    private readonly helper: Pick<
      OcrHelperModule,
      "preprocessBmp" | "normalizeOverlay" | "buildTextLayer"
    >,
    private readonly pageProcessor: OcrPageProcessor,
    private readonly recognizer: OcrRecognizer,
    private readonly overlayApplier: OverlayApplier,
  ) {}

  /**
   * Runs OCR over `inputBytes` (a PDF or PNG/JPEG image) and returns a searchable PDF
   * that looks pixel-identical to the input, plus extracted text and per-page telemetry.
   *
   * @param inputBytes Raw uploaded PDF, PNG, or JPEG bytes.
   * @param rawOptions User OCR options.
   * @param password Optional open password for encrypted PDFs.
   * @param onProgress Optional progress callback (`0..1`, stage label).
   * @param cancelToken Optional cooperative cancellation token.
   * @returns {@link OcrOutcome}.
   */
  async run(
    inputBytes: Uint8Array,
    rawOptions: OcrOptions,
    password = "",
    onProgress: OcrProgressCallback = () => {},
    cancelToken: OcrCancelToken = { cancelled: false },
  ): Promise<OcrOutcome> {
    if (inputBytes.length === 0) {
      return { kind: "failed", message: "The file is empty (0 bytes)." };
    }

    const validationError = validateOcrOptions(rawOptions);
    if (validationError) {
      return { kind: "failed", message: validationError };
    }
    const options = normalizeOcrOptions(rawOptions);

    try {
      onProgress(0.04, "Checking file structure…");
      const { pdfBytes, wasImageInput } =
        this.pageProcessor.ensurePdfBytes(inputBytes);

      if (!wasImageInput) {
        const probe = this.overlayApplier.probePdf(pdfBytes, password);
        if (probe.status === "password-required") {
          return {
            kind: "password-required",
            wrongPassword: probe.wrongPassword,
          };
        }
        if (probe.status === "unreadable") {
          return { kind: "failed", message: probe.message };
        }
      }

      if (cancelToken.cancelled) {
        return { kind: "cancelled" };
      }

      onProgress(0.08, "Inspecting pages for existing text…");
      const inspected = this.pageProcessor.inspectPages(pdfBytes, password);
      const total = inspected.length;

      const pageResults: OcrPageResult[] = [];
      const overlays: PageOverlayEntry[] = [];

      for (let i = 0; i < total; i++) {
        if (cancelToken.cancelled) {
          return { kind: "cancelled" };
        }

        const pageInfo = inspected[i];
        const baseFraction = 0.1 + (i / total) * 0.8;
        const pageSlice = 0.8 / total;

        // Skip pages that already carry real selectable text unless "Redo OCR" is enabled.
        if (pageInfo.hasExistingText && !options.redoExistingText) {
          onProgress(
            baseFraction + pageSlice,
            `Page ${i + 1} of ${total} already has text (skipped)`,
          );
          pageResults.push({
            pageIndex: i,
            status: "skipped-existing-text",
            text: pageInfo.existingText,
            confidence: null,
            wordCount: countWords(pageInfo.existingText),
          });
          continue;
        }

        onProgress(
          baseFraction + pageSlice * 0.1,
          `Rendering page ${i + 1} of ${total} at ${options.dpi} DPI…`,
        );
        const rendered = this.pageProcessor.renderPageForOcr(
          pdfBytes,
          password,
          i,
          options.dpi,
        );

        const bmp = this.helper.preprocessBmp(
          rendered.pixels,
          rendered.width,
          rendered.height,
          rendered.effectiveDpiX,
          rendered.effectiveDpiY,
          options.enhanceScan,
        );

        onProgress(
          baseFraction + pageSlice * 0.25,
          `Recognizing text on page ${i + 1} of ${total}…`,
        );

        const recognized = await this.recognizer.recognizePage(
          bmp,
          rendered.effectiveDpiX,
          options.languages,
          (subFraction) => {
            if (!cancelToken.cancelled) {
              onProgress(
                baseFraction + pageSlice * (0.25 + subFraction * 0.7),
                `Recognizing text on page ${i + 1} of ${total}…`,
              );
            }
          },
        );

        if (cancelToken.cancelled) {
          return { kind: "cancelled" };
        }

        // Prefer Tesseract's native glyphless-font PDF when available, normalized to
        // exact target PDF points; fall back to Rust TSV-based invisible text-layer PDF.
        const rawOverlay =
          recognized.pdfOverlay && recognized.pdfOverlay.length > 0
            ? this.helper.normalizeOverlay(
                recognized.pdfOverlay,
                rendered.placementSize.width,
                rendered.placementSize.height,
              )
            : this.helper.buildTextLayer(
                recognized.tsv,
                rendered.placementSize.width,
                rendered.placementSize.height,
                rendered.width,
                rendered.height,
              );

        overlays.push({ pageIndex: i, overlayPdf: rawOverlay });
        pageResults.push({
          pageIndex: i,
          status: "ocr",
          text: recognized.text,
          confidence: Math.round(recognized.confidence),
          wordCount: countWords(recognized.text),
        });
      }

      if (cancelToken.cancelled) {
        return { kind: "cancelled" };
      }

      onProgress(0.92, "Embedding invisible text layer into PDF…");
      const searchablePdf =
        overlays.length > 0
          ? this.overlayApplier.applyOverlays(pdfBytes, password, overlays)
          : pdfBytes;

      onProgress(1, "Finished");
      return {
        kind: "completed",
        pdf: searchablePdf,
        report: buildOcrReport(pageResults),
        wasImageInput,
      };
    } catch (err: unknown) {
      if (err instanceof PdfOpenError && err.reason === "password") {
        return {
          kind: "password-required",
          wrongPassword: Boolean(password),
        };
      }
      return {
        kind: "failed",
        message: errorMessage(err) || "Could not perform OCR on this file.",
      };
    }
  }
}
