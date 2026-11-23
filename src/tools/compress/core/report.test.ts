import { describe, expect, it } from "vitest";
import {
  formatReductionPercent,
  formatSavingsSummary,
  parseCompressReport,
} from "./report";

describe("compress core report", () => {
  it("parses valid WASM report JSON and falls back on malformed JSON", () => {
    const parsed = parseCompressReport(
      JSON.stringify({
        originalBytes: 1000,
        compressedBytes: 400,
        imagesInspected: 3,
        imagesReencoded: 2,
        imagesDownsampled: 1,
        imagesDeduplicated: 1,
        imagesSkippedLarger: 0,
        flateStreamsRecompressed: 4,
        objectsRemoved: 2,
        transparencyPreserved: 1,
        notes: ["Preserved soft mask"],
      }),
      1000,
      400,
    );
    expect(parsed.imagesReencoded).toBe(2);
    expect(parsed.transparencyPreserved).toBe(1);
    expect(parsed.notes).toEqual(["Preserved soft mask"]);

    const fallback = parseCompressReport("not-json", 500, 500);
    expect(fallback.originalBytes).toBe(500);
    expect(fallback.imagesReencoded).toBe(0);
  });

  it("computes reduction percentage safely", () => {
    expect(formatReductionPercent(1000, 400)).toBe(60);
    expect(formatReductionPercent(1000, 1200)).toBe(0);
    expect(formatReductionPercent(0, 0)).toBe(0);
  });

  it("formats readable savings summaries", () => {
    const summary = formatSavingsSummary({
      originalBytes: 1_000_000,
      compressedBytes: 400_000,
      imagesInspected: 2,
      imagesReencoded: 2,
      imagesDownsampled: 1,
      imagesDeduplicated: 1,
      imagesSkippedLarger: 0,
      flateStreamsRecompressed: 0,
      objectsRemoved: 0,
      transparencyPreserved: 1,
      notes: [],
    });
    expect(summary).toContain("60% smaller");
    expect(summary).toContain("2 images optimized");
    expect(summary).toContain("1 duplicate stream merged");
    expect(summary).toContain("transparency preserved");

    const unchanged = formatSavingsSummary({
      originalBytes: 1000,
      compressedBytes: 1000,
      imagesInspected: 0,
      imagesReencoded: 0,
      imagesDownsampled: 0,
      imagesDeduplicated: 0,
      imagesSkippedLarger: 0,
      flateStreamsRecompressed: 0,
      objectsRemoved: 0,
      transparencyPreserved: 0,
      notes: [],
    });
    expect(unchanged).toContain("no size increase");
  });
});
