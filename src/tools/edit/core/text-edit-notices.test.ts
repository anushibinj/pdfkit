import { describe, expect, it } from "vitest";
import { describeTextOutcome, shortQuote } from "./text-edit-notices";

const done = { runId: "1", applied: true, substituteFont: null };

describe("shortQuote", () => {
  it("trims and shortens long text", () => {
    expect(shortQuote("  Total  ")).toBe("Total");
    expect(shortQuote("x".repeat(40))).toBe(`${"x".repeat(30)}…`);
  });
});

describe("describeTextOutcome", () => {
  it("says nothing when the line kept its own font", () => {
    expect(
      describeTextOutcome(
        { runId: "1", text: "Total 1520" },
        { ...done, written: "Total 1520" },
      ),
    ).toBeNull();
  });

  it("explains a substitute font", () => {
    expect(
      describeTextOutcome(
        { runId: "1", text: "Zoe" },
        { ...done, written: "Zoe", substituteFont: "Helvetica" },
      ),
    ).toBe(
      "“Zoe” is written in Helvetica: the PDF's own font for that line lacks some of the characters you typed.",
    );
  });

  it("lists characters no standard font could write", () => {
    expect(
      describeTextOutcome(
        { runId: "1", text: "Pay ₹50 ₹" },
        { ...done, written: "Pay 50 ", substituteFont: "Helvetica" },
      ),
    ).toMatch(/Left out \(no standard font has them\): ₹$/);
  });

  it("reports an edit that could not be applied", () => {
    expect(
      describeTextOutcome(
        { runId: "9", text: "New" },
        { runId: "9", applied: false, written: "", substituteFont: null },
      ),
    ).toBe("Could not change “New”: that line was not found on the page.");
  });
});
