import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPAIR_REPORT,
  formatRepairSummary,
  parseRepairReport,
} from "./report";

describe("parseRepairReport", () => {
  it("returns default report for empty or whitespace string", () => {
    expect(parseRepairReport("")).toEqual(DEFAULT_REPAIR_REPORT);
    expect(parseRepairReport("   \n")).toEqual(DEFAULT_REPAIR_REPORT);
  });

  it("returns default report for malformed JSON syntax", () => {
    expect(parseRepairReport("{not-valid-json}")).toEqual(DEFAULT_REPAIR_REPORT);
    expect(parseRepairReport("null")).toEqual(DEFAULT_REPAIR_REPORT);
  });

  it("parses valid JSON with complete fields", () => {
    const raw = JSON.stringify({
      headerRepaired: true,
      eofRepaired: true,
      xrefReconstructed: true,
      trailerReconstructed: true,
      objectsRecovered: 42,
      streamsRepaired: 3,
      pagesRecovered: 5,
      issues: ["Fixed cross-reference table", "Restored %PDF-1.7 header"],
    });

    const parsed = parseRepairReport(raw);
    expect(parsed).toEqual({
      headerRepaired: true,
      eofRepaired: true,
      xrefReconstructed: true,
      trailerReconstructed: true,
      objectsRecovered: 42,
      streamsRepaired: 3,
      pagesRecovered: 5,
      issues: ["Fixed cross-reference table", "Restored %PDF-1.7 header"],
    });
  });

  it("handles partial or missing keys safely", () => {
    const raw = JSON.stringify({
      pagesRecovered: 2,
      xrefReconstructed: true,
    });

    const parsed = parseRepairReport(raw);
    expect(parsed.pagesRecovered).toBe(2);
    expect(parsed.xrefReconstructed).toBe(true);
    expect(parsed.headerRepaired).toBe(false);
    expect(parsed.issues).toEqual([]);
  });

  it("filters non-string items from issues array", () => {
    const raw = JSON.stringify({
      issues: ["Valid issue", 123, null, "  Another issue  ", ""],
    });

    const parsed = parseRepairReport(raw);
    expect(parsed.issues).toEqual(["Valid issue", "Another issue"]);
  });
});

describe("formatRepairSummary", () => {
  it("formats fallback when no repairs were recorded", () => {
    expect(formatRepairSummary(DEFAULT_REPAIR_REPORT)).toBe(
      "Document structure checked and standardized.",
    );
  });

  it("formats singular page count", () => {
    const report = {
      ...DEFAULT_REPAIR_REPORT,
      pagesRecovered: 1,
      xrefReconstructed: true,
    };
    expect(formatRepairSummary(report)).toBe(
      "1 page recovered, cross-reference table rebuilt.",
    );
  });

  it("formats plural page count and multiple repaired components", () => {
    const report = {
      ...DEFAULT_REPAIR_REPORT,
      pagesRecovered: 8,
      xrefReconstructed: true,
      trailerReconstructed: true,
      headerRepaired: true,
      eofRepaired: true,
    };
    expect(formatRepairSummary(report)).toBe(
      "8 pages recovered, cross-reference table rebuilt, trailer dictionary restored, header restored, EOF marker fixed.",
    );
  });
});
