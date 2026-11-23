/**
 * Parsing and formatting helpers for compression telemetry reports.
 *
 * Follows Single Responsibility Principle (SRP) by isolating JSON decoding
 * and user-facing savings copy from compression orchestration and UI markup.
 */

import { formatBytes } from "@/lib/format";
import type { CompressReport } from "./model";

/**
 * Safely parses raw JSON emitted by `pdf-compress.wasm` into a typed {@link CompressReport}.
 *
 * Applies defensive defaults so unexpected fields or malformed JSON never throw
 * across worker boundaries.
 *
 * @param json JSON string returned by the WASM engine.
 * @param originalBytes Original PDF byte length.
 * @param compressedBytes Compressed PDF byte length.
 * @returns Validated {@link CompressReport}.
 */
export function parseCompressReport(
  json: string,
  originalBytes: number,
  compressedBytes: number,
): CompressReport {
  const fallback: CompressReport = {
    originalBytes,
    compressedBytes,
    imagesInspected: 0,
    imagesReencoded: 0,
    imagesDownsampled: 0,
    imagesDeduplicated: 0,
    imagesSkippedLarger: 0,
    flateStreamsRecompressed: 0,
    objectsRemoved: 0,
    transparencyPreserved: 0,
    notes: [],
  };

  if (!json || json.trim() === "") {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return fallback;
    }
    const obj = parsed as Record<string, unknown>;
    const nonNeg = (v: unknown, def: number): number =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : def;

    const notes = Array.isArray(obj.notes)
      ? obj.notes.filter(
          (n): n is string => typeof n === "string" && n.trim().length > 0,
        )
      : [];

    return {
      originalBytes: nonNeg(obj.originalBytes, originalBytes),
      compressedBytes: nonNeg(obj.compressedBytes, compressedBytes),
      imagesInspected: nonNeg(obj.imagesInspected, 0),
      imagesReencoded: nonNeg(obj.imagesReencoded, 0),
      imagesDownsampled: nonNeg(obj.imagesDownsampled, 0),
      imagesDeduplicated: nonNeg(obj.imagesDeduplicated, 0),
      imagesSkippedLarger: nonNeg(obj.imagesSkippedLarger, 0),
      flateStreamsRecompressed: nonNeg(obj.flateStreamsRecompressed, 0),
      objectsRemoved: nonNeg(obj.objectsRemoved, 0),
      transparencyPreserved: nonNeg(obj.transparencyPreserved, 0),
      notes,
    };
  } catch {
    return fallback;
  }
}

/**
 * Computes percentage size reduction rounded to the nearest whole percent,
 * clamped to `[0, 100]`.
 *
 * @param originalBytes Original file size in bytes.
 * @param compressedBytes Compressed file size in bytes.
 * @returns Integer percentage saved (e.g. `62` for 62% smaller).
 */
export function formatReductionPercent(
  originalBytes: number,
  compressedBytes: number,
): number {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0;
  if (!Number.isFinite(compressedBytes) || compressedBytes >= originalBytes) return 0;
  const ratio = ((originalBytes - compressedBytes) / originalBytes) * 100;
  return Math.min(100, Math.max(0, Math.round(ratio)));
}

/**
 * Formats a concise human-readable summary of savings and optimizations applied.
 *
 * @param report Parsed {@link CompressReport}.
 * @returns Summary sentence for display in file rows or alerts.
 */
export function formatSavingsSummary(report: CompressReport): string {
  const saved = report.originalBytes - report.compressedBytes;
  if (saved <= 0) {
    return "Already compact — kept original bytes with no size increase.";
  }

  const pct = formatReductionPercent(report.originalBytes, report.compressedBytes);
  const details: string[] = [];

  if (report.imagesReencoded > 0) {
    details.push(
      `${report.imagesReencoded} ${report.imagesReencoded === 1 ? "image" : "images"} optimized`,
    );
  }
  if (report.imagesDeduplicated > 0) {
    details.push(
      `${report.imagesDeduplicated} duplicate ${report.imagesDeduplicated === 1 ? "stream" : "streams"} merged`,
    );
  }
  if (report.flateStreamsRecompressed > 0) {
    details.push(
      `${report.flateStreamsRecompressed} ${report.flateStreamsRecompressed === 1 ? "stream" : "streams"} recompressed`,
    );
  }
  if (report.transparencyPreserved > 0) {
    details.push("transparency preserved");
  }

  const base = `Saved ${formatBytes(saved)} (${pct}% smaller)`;
  return details.length > 0 ? `${base} · ${details.join(", ")}.` : `${base}.`;
}
