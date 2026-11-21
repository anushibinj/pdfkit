import { describe, expect, it } from "vitest";
import { friendlyQpdfMessage, isInvalidPassword, isOutOfMemory } from "./qpdf-run";

describe("qpdf output helpers", () => {
  it("detects invalid password messages", () => {
    expect(isInvalidPassword("this.program: /job-1-in.pdf: invalid password")).toBe(true);
    expect(isInvalidPassword("something else")).toBe(false);
  });

  it("cleans up qpdf messages", () => {
    expect(friendlyQpdfMessage("")).toMatch(/could not process/);
    expect(
      friendlyQpdfMessage("WARNING: /job-1-in.pdf: can't find PDF header\nthis.program: /job-1-in.pdf: can't find startxref"),
    ).toMatch(/valid PDF/);
    expect(friendlyQpdfMessage("this.program: /job-2-x.pdf: something odd happened")).toBe(
      "Something odd happened",
    );
  });

  it("recognises out-of-memory failures", () => {
    expect(isOutOfMemory(new RangeError("Array buffer allocation failed"))).toBe(true);
    expect(isOutOfMemory(new Error("memory access out of bounds"))).toBe(true);
    expect(isOutOfMemory(new Error("invalid password"))).toBe(false);
  });
});
