/**
 * Target-size ("make it under X MB") compression solver.
 *
 * Implements Open/Closed Principle (OCP) and Single Responsibility Principle (SRP):
 * iterates through a calibrated ladder of quality and DPI steps until the target
 * file size is met, or stops at safe visual-quality floors and explains clearly why
 * the target cannot be reached without wrecking the document.
 */

import { formatBytes } from "@/lib/format";
import type {
  CompressReport,
  ResolvedPassConfig,
  TargetSizeEvaluation,
} from "./model";

/** Lowest DPI attempted before declaring the target unreachable without ruining legibility. */
export const MIN_SAFE_DPI = 72;
/** Lowest JPEG quality attempted before declaring the target unreachable. */
export const MIN_SAFE_QUALITY = 0.4;

/** Result of a single compression pass evaluated by {@link TargetSizeSolver}. */
export interface SolverPassResult {
  pdf: Uint8Array;
  report: CompressReport;
}

/** Callback invoked by {@link TargetSizeSolver} to run one candidate pass. */
export type RunPassCallback = (
  config: ResolvedPassConfig,
  stepIndex: number,
  totalSteps: number,
) => Promise<SolverPassResult>;

/**
 * Builds the ordered ladder of compression configurations from gentlest (lossless)
 * to most compact within safe visual legibility bounds (`>= 72 DPI`, `>= 40% quality`).
 *
 * @param grayscale Whether the user opted into grayscale conversion during lossy passes.
 * @returns Ordered array of {@link ResolvedPassConfig} candidates.
 */
export function buildTargetSizeLadder(grayscale: boolean): ResolvedPassConfig[] {
  return [
    { lossless: true, targetDpi: 0, quality: 1.0, grayscale: false },
    { lossless: false, targetDpi: 150, quality: 0.8, grayscale },
    { lossless: false, targetDpi: 150, quality: 0.7, grayscale },
    { lossless: false, targetDpi: 120, quality: 0.62, grayscale },
    { lossless: false, targetDpi: 100, quality: 0.55, grayscale },
    { lossless: false, targetDpi: 85, quality: 0.48, grayscale },
    {
      lossless: false,
      targetDpi: MIN_SAFE_DPI,
      quality: MIN_SAFE_QUALITY,
      grayscale,
    },
  ];
}

/**
 * Generates a clear, truthful explanation when a PDF cannot reach `targetBytes`
 * within safe readability bounds (`>= 72 DPI`, `>= 40% quality`).
 *
 * Distinguishes between:
 * 1. Text/vector/font-heavy PDFs with no compressible opaque images (lossy image
 *    passes cannot shrink text streams or embedded fonts further).
 * 2. Image-heavy PDFs that already hit the minimum safe 72 DPI / 40% quality floor.
 *
 * @param targetBytes Requested maximum size in bytes.
 * @param achievedBytes Best compressed size achieved in bytes.
 * @param report Telemetry report from the best candidate pass.
 * @returns User-facing explanation string.
 */
export function explainUnreachableTarget(
  targetBytes: number,
  achievedBytes: number,
  report: CompressReport,
): string {
  const targetLabel = formatBytes(targetBytes);
  const achievedLabel = formatBytes(achievedBytes);

  if (report.imagesInspected === 0 || report.imagesReencoded === 0) {
    return (
      `Could not reach ${targetLabel} (smallest lossless size is ${achievedLabel}). ` +
      "This PDF is mostly text, vector graphics, or fonts rather than high-resolution photos, " +
      "so reducing image quality cannot shrink it further without removing content."
    );
  }

  return (
    `Could not reach ${targetLabel} without making images blurry or unreadable ` +
    `(best safe size is ${achievedLabel} at ${MIN_SAFE_DPI} DPI and ${Math.round(MIN_SAFE_QUALITY * 100)}% quality). ` +
    "Try splitting the document or enabling grayscale conversion for further savings."
  );
}

/**
 * Iteratively searches the quality/DPI ladder to meet a target byte ceiling.
 */
export class TargetSizeSolver {
  /**
   * Evaluates candidate configurations in order, returning immediately once
   * `result.pdf.length <= targetBytes`.
   *
   * Optimization: if the lossless pass finds `imagesInspected === 0`, skips the
   * remaining lossy image passes because they only affect images and cannot shrink
   * a pure text/vector PDF further.
   *
   * Always tracks the smallest PDF observed across all evaluated steps.
   *
   * @param targetBytes Target upper bound in bytes.
   * @param grayscale Whether lossy passes should convert opaque images to grayscale.
   * @param runPass Callback executing a single compression pass.
   * @returns The best PDF, its telemetry report, and {@link TargetSizeEvaluation}.
   */
  async solve(
    targetBytes: number,
    grayscale: boolean,
    runPass: RunPassCallback,
  ): Promise<{
    pdf: Uint8Array;
    report: CompressReport;
    evaluation: TargetSizeEvaluation;
  }> {
    const ladder = buildTargetSizeLadder(grayscale);
    let bestPdf: Uint8Array | null = null;
    let bestReport: CompressReport | null = null;
    let bestConfig: ResolvedPassConfig = ladder[0];
    let attempts = 0;

    for (let i = 0; i < ladder.length; i++) {
      const config = ladder[i];
      attempts++;
      const res = await runPass(config, i, ladder.length);

      if (!bestPdf || res.pdf.length < bestPdf.length) {
        bestPdf = res.pdf;
        bestReport = res.report;
        bestConfig = config;
      }

      if (res.pdf.length <= targetBytes) {
        return {
          pdf: res.pdf,
          report: res.report,
          evaluation: {
            targetBytes,
            targetMet: true,
            attempts,
            appliedConfig: config,
          },
        };
      }

      // A PDF with zero inspected images cannot benefit from lossy image steps.
      if (i === 0 && res.report.imagesInspected === 0) {
        break;
      }
    }

    const finalPdf = bestPdf!;
    const finalReport = bestReport!;
    return {
      pdf: finalPdf,
      report: finalReport,
      evaluation: {
        targetBytes,
        targetMet: false,
        attempts,
        appliedConfig: bestConfig,
        explanation: explainUnreachableTarget(
          targetBytes,
          finalPdf.length,
          finalReport,
        ),
      },
    };
  }
}
