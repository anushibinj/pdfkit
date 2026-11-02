import { describe, expect, it } from "vitest";
import { formatBytes, isPdfFile, suffixedPdfName } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1 MB"],
    [5.25 * 1024 * 1024, "5.25 MB"],
    [500 * 1024 * 1024, "500 MB"],
    [3 * 1024 ** 3, "3 GB"],
  ])("%d -> %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it("handles invalid input", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("suffixedPdfName", () => {
  it("adds the suffix before .pdf", () => {
    expect(suffixedPdfName("report.pdf", "-unlocked")).toBe("report-unlocked.pdf");
    expect(suffixedPdfName("Report.PDF", "-unlocked")).toBe("Report-unlocked.pdf");
  });
  it("adds .pdf when missing and handles empty names", () => {
    expect(suffixedPdfName("scan", "-unlocked")).toBe("scan-unlocked.pdf");
    expect(suffixedPdfName(".pdf", "-unlocked")).toBe("document-unlocked.pdf");
  });
});

describe("isPdfFile", () => {
  it("accepts by MIME type or extension", () => {
    expect(isPdfFile({ name: "a.bin", type: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "a.PDF", type: "" })).toBe(true);
    expect(isPdfFile({ name: "a.png", type: "image/png" })).toBe(false);
  });
});
