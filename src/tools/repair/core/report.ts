/**
 * Parsing and human-readable formatting of PDF repair reports.
 *
 * Implements Single Responsibility Principle (SRP) by isolating report parsing
 * and textual presentation from engine execution and UI layout.
 */

import type { RepairReport } from "./model";

/** Fallback report used when raw JSON cannot be decoded or is absent. */
export const DEFAULT_REPAIR_REPORT: RepairReport = {
  headerRepaired: false,
  eofRepaired: false,
  xrefReconstructed: false,
  trailerReconstructed: false,
  objectsRecovered: 0,
  streamsRepaired: 0,
  pagesRecovered: 0,
  issues: [],
};

/**
 * Parses raw JSON output emitted by the WebAssembly repair engine into a typed {@link RepairReport}.
 *
 * Validates each field with runtime type guards so unexpected formats or missing keys
 * fall back gracefully to safe defaults rather than throwing exceptions across thread boundaries.
 *
 * @param json The JSON string produced by the WebAssembly engine or worker.
 * @returns A validated, typed {@link RepairReport} object.
 */
export function parseRepairReport(json: string): RepairReport {
  if (!json || json.trim() === "") {
    return { ...DEFAULT_REPAIR_REPORT };
  }

  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_REPAIR_REPORT };
    }

    const obj = parsed as Record<string, unknown>;

    // Type-safe property extraction with explicit fallbacks
    const headerRepaired = Boolean(obj.headerRepaired);
    const eofRepaired = Boolean(obj.eofRepaired);
    const xrefReconstructed = Boolean(obj.xrefReconstructed);
    const trailerReconstructed = Boolean(obj.trailerReconstructed);
    const objectsRecovered = typeof obj.objectsRecovered === "number" ? Math.max(0, obj.objectsRecovered) : 0;
    const streamsRepaired = typeof obj.streamsRepaired === "number" ? Math.max(0, obj.streamsRepaired) : 0;
    const pagesRecovered = typeof obj.pagesRecovered === "number" ? Math.max(0, obj.pagesRecovered) : 0;

    let issues: string[] = [];
    if (Array.isArray(obj.issues)) {
      issues = obj.issues
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((s) => s.trim());
    }

    return {
      headerRepaired,
      eofRepaired,
      xrefReconstructed,
      trailerReconstructed,
      objectsRecovered,
      streamsRepaired,
      pagesRecovered,
      issues,
    };
  } catch {
    // Malformed JSON falls back gracefully to default empty report
    return { ...DEFAULT_REPAIR_REPORT };
  }
}

/**
 * Formats a concise summary sentence describing key structural modifications made to the PDF.
 *
 * @param report The parsed repair report.
 * @returns A user-facing sentence summarizing recovered pages and reconstructed components.
 */
export function formatRepairSummary(report: RepairReport): string {
  const parts: string[] = [];

  if (report.pagesRecovered > 0) {
    parts.push(`${report.pagesRecovered} ${report.pagesRecovered === 1 ? "page" : "pages"} recovered`);
  }

  if (report.xrefReconstructed) {
    parts.push("cross-reference table rebuilt");
  }

  if (report.trailerReconstructed) {
    parts.push("trailer dictionary restored");
  }

  if (report.headerRepaired) {
    parts.push("header restored");
  }

  if (report.eofRepaired) {
    parts.push("EOF marker fixed");
  }

  if (parts.length === 0) {
    return "Document structure checked and standardized.";
  }

  // Capitalize first character of sentence
  const summary = parts.join(", ");
  return summary.charAt(0).toUpperCase() + summary.slice(1) + ".";
}
