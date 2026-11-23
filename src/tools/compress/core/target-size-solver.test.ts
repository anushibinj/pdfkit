import { describe, expect, it, vi } from "vitest";
import type { CompressReport } from "./model";
import {
  buildTargetSizeLadder,
  explainUnreachableTarget,
  MIN_SAFE_DPI,
  MIN_SAFE_QUALITY,
  TargetSizeSolver,
} from "./target-size-solver";

function makeReport(overrides: Partial<CompressReport> = {}): CompressReport {
  return {
    originalBytes: 5_000_000,
    compressedBytes: 2_500_000,
    imagesInspected: 3,
    imagesReencoded: 2,
    imagesDownsampled: 1,
    imagesDeduplicated: 0,
    imagesSkippedLarger: 0,
    flateStreamsRecompressed: 1,
    objectsRemoved: 0,
    transparencyPreserved: 0,
    notes: [],
    ...overrides,
  };
}

describe("TargetSizeSolver", () => {
  it("builds a descending quality/DPI ladder ending at safe floor", () => {
    const ladder = buildTargetSizeLadder(true);
    expect(ladder[0].lossless).toBe(true);
    const last = ladder[ladder.length - 1];
    expect(last.targetDpi).toBe(MIN_SAFE_DPI);
    expect(last.quality).toBe(MIN_SAFE_QUALITY);
    expect(last.grayscale).toBe(true);
  });

  it("stops immediately when lossless pass already fits under target", async () => {
    const solver = new TargetSizeSolver();
    const runPass = vi.fn(async () => ({
      pdf: new Uint8Array(900_000),
      report: makeReport({ compressedBytes: 900_000 }),
    }));

    const out = await solver.solve(1_000_000, false, runPass);
    expect(runPass).toHaveBeenCalledTimes(1);
    expect(out.evaluation.targetMet).toBe(true);
    expect(out.evaluation.attempts).toBe(1);
    expect(out.evaluation.appliedConfig.lossless).toBe(true);
  });

  it("steps through ladder until target is met mid-way", async () => {
    const solver = new TargetSizeSolver();
    const sizes = [3_000_000, 2_400_000, 1_800_000];
    const runPass = vi.fn(async (_cfg, stepIdx) => ({
      pdf: new Uint8Array(sizes[stepIdx] ?? 1_800_000),
      report: makeReport({ compressedBytes: sizes[stepIdx] ?? 1_800_000 }),
    }));

    const out = await solver.solve(2_000_000, false, runPass);
    expect(runPass).toHaveBeenCalledTimes(3);
    expect(out.evaluation.targetMet).toBe(true);
    expect(out.evaluation.attempts).toBe(3);
    expect(out.pdf.length).toBe(1_800_000);
  });

  it("short-circuits lossy passes on text-only PDFs with 0 images", async () => {
    const solver = new TargetSizeSolver();
    const runPass = vi.fn(async () => ({
      pdf: new Uint8Array(1_500_000),
      report: makeReport({
        imagesInspected: 0,
        imagesReencoded: 0,
        compressedBytes: 1_500_000,
      }),
    }));

    const out = await solver.solve(500_000, false, runPass);
    expect(runPass).toHaveBeenCalledTimes(1);
    expect(out.evaluation.targetMet).toBe(false);
    expect(out.evaluation.explanation).toMatch(/text, vector graphics, or fonts/i);
  });

  it("explains clearly when image-heavy PDF cannot safely reach target", async () => {
    const solver = new TargetSizeSolver();
    const runPass = vi.fn(async (_cfg, stepIdx) => ({
      pdf: new Uint8Array(2_000_000 - stepIdx * 100_000),
      report: makeReport({
        imagesInspected: 5,
        imagesReencoded: 5,
        compressedBytes: 2_000_000 - stepIdx * 100_000,
      }),
    }));

    const out = await solver.solve(500_000, false, runPass);
    expect(out.evaluation.targetMet).toBe(false);
    expect(out.evaluation.attempts).toBe(buildTargetSizeLadder(false).length);
    expect(out.evaluation.explanation).toMatch(/blurry or unreadable/i);
    expect(out.pdf.length).toBe(1_400_000);
  });

  it("formats unreachable target explanations cleanly", () => {
    const textMsg = explainUnreachableTarget(
      100_000,
      500_000,
      makeReport({ imagesInspected: 0, imagesReencoded: 0 }),
    );
    expect(textMsg).toContain("mostly text");

    const imgMsg = explainUnreachableTarget(100_000, 500_000, makeReport());
    expect(imgMsg).toContain("72 DPI");
  });
});
