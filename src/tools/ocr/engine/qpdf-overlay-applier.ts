/**
 * qpdf overlay applier and encryption probe for the OCR PDF tool.
 *
 * Follows Single Responsibility Principle (SRP) and Dependency Inversion Principle (DIP):
 * operates strictly against {@link QpdfRunner} so unit tests can run against `FakeQpdfRunner`.
 *
 * Why `qpdf --overlay`:
 * Overlaying the invisible text-only PDF onto the original PDF preserves every original
 * image, vector stroke, color profile, form field, annotation, and password protection
 * untouched — guaranteeing the output looks pixel-identical to the input.
 */

import { probeEncryption } from "@/lib/qpdf/encryption-status";
import { EXIT_ERROR, EXIT_OK, EXIT_WARNINGS, friendlyQpdfMessage } from "@/lib/qpdf/qpdf-output";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { removeScratchFiles, scratchFiles } from "@/lib/qpdf/scratch-files";
import { formatPageRanges } from "@/lib/page-ranges";

/** One 1-page invisible text-layer PDF mapped to a 0-based page index in the source PDF. */
export interface PageOverlayEntry {
  /** Zero-based page index in the destination PDF. */
  pageIndex: number;
  /** Serialized 1-page text-only PDF bytes. */
  overlayPdf: Uint8Array;
}

/** Result of probing whether a PDF requires or accepts a password. */
export type OcrEncryptionProbe =
  | { status: "ready" }
  | { status: "password-required"; wrongPassword: boolean }
  | { status: "unreadable"; message: string };

/** Contract implemented by {@link QpdfOverlayApplier} for unit testing. */
export interface OverlayApplier {
  probePdf(pdfBytes: Uint8Array, password: string): OcrEncryptionProbe;
  applyOverlays(
    sourcePdfBytes: Uint8Array,
    password: string,
    overlays: readonly PageOverlayEntry[],
  ): Uint8Array;
}

/**
 * Applies per-page invisible text overlays onto a PDF using `qpdf --overlay`.
 */
export class QpdfOverlayApplier implements OverlayApplier {
  private seq = 0;

  /**
   * @param qpdf Abstract qpdf runner (real WASM module or fake in tests).
   */
  constructor(private readonly qpdf: QpdfRunner) {}

  /**
   * Checks whether `pdfBytes` is valid and whether `password` unlocks it (if encrypted).
   *
   * @param pdfBytes Raw PDF bytes.
   * @param password Candidate user password (or `""`).
   * @returns {@link OcrEncryptionProbe}.
   */
  probePdf(pdfBytes: Uint8Array, password: string): OcrEncryptionProbe {
    const files = scratchFiles(`ocr-probe-${++this.seq}`);
    this.qpdf.writeFile(files.input, pdfBytes);

    try {
      const probe = probeEncryption(this.qpdf, files.input);
      if (probe.kind === "unreadable") {
        return { status: "unreadable", message: probe.message };
      }
      if (
        probe.kind === "not-encrypted" ||
        probe.kind === "opens-without-password"
      ) {
        return { status: "ready" };
      }
      if (!password) {
        return { status: "password-required", wrongPassword: false };
      }

      const check = this.qpdf.run([
        `--password=${password}`,
        "--show-npages",
        files.input,
      ]);
      if (check.code === EXIT_OK || check.code === EXIT_WARNINGS) {
        return { status: "ready" };
      }
      return { status: "password-required", wrongPassword: true };
    } finally {
      removeScratchFiles(this.qpdf, files);
    }
  }

  /**
   * Merges all 1-page text-only `overlays` into a single multi-page stamp PDF and
   * overlays each stamp page onto its corresponding page in `sourcePdfBytes`.
   *
   * @param sourcePdfBytes Original PDF bytes.
   * @param password User password for encrypted PDFs, or `""`.
   * @param overlays Ordered list of 1-page overlay PDFs and target page indices.
   * @returns Final searchable PDF bytes.
   */
  applyOverlays(
    sourcePdfBytes: Uint8Array,
    password: string,
    overlays: readonly PageOverlayEntry[],
  ): Uint8Array {
    if (overlays.length === 0) {
      return sourcePdfBytes;
    }

    const token = `ocr-apply-${++this.seq}`;
    const files = scratchFiles(token);
    const stampParts: string[] = [];

    try {
      this.qpdf.writeFile(files.input, sourcePdfBytes);

      let stampPath: string;
      if (overlays.length === 1) {
        stampPath = `/${token}-stamp-0.pdf`;
        stampParts.push(stampPath);
        this.qpdf.writeFile(stampPath, overlays[0].overlayPdf);
      } else {
        // Combine individual 1-page text-only PDFs into one multi-page overlay PDF
        // so qpdf performs a single pass over the original document.
        const mergeArgs: string[] = ["--empty", "--pages"];
        overlays.forEach((entry, idx) => {
          const partPath = `/${token}-part-${idx}.pdf`;
          stampParts.push(partPath);
          this.qpdf.writeFile(partPath, entry.overlayPdf);
          mergeArgs.push(partPath, "1");
        });
        stampPath = `/${token}-stamp.pdf`;
        stampParts.push(stampPath);
        mergeArgs.push("--", stampPath);

        const mergeRun = this.qpdf.run(mergeArgs);
        if (mergeRun.code === EXIT_ERROR || !this.qpdf.exists(stampPath)) {
          throw new Error(friendlyQpdfMessage(mergeRun.stderr));
        }
      }

      const toPages = overlays.map((o) => o.pageIndex);
      const fromPages = overlays.map((_, idx) => idx);
      const passwordArgs = password ? [`--password=${password}`] : [];

      const overlayRun = this.qpdf.run([
        ...passwordArgs,
        files.input,
        "--overlay",
        stampPath,
        `--to=${formatPageRanges(toPages)}`,
        `--from=${formatPageRanges(fromPages)}`,
        "--",
        files.output,
      ]);

      if (overlayRun.code === EXIT_ERROR || !this.qpdf.exists(files.output)) {
        throw new Error(friendlyQpdfMessage(overlayRun.stderr));
      }

      return this.qpdf.readFile(files.output).slice();
    } finally {
      for (const path of stampParts) {
        this.qpdf.remove(path);
      }
      removeScratchFiles(this.qpdf, files);
    }
  }
}
