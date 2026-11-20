import { describe, expect, it } from "vitest";
import { friendlyQpdfMessage, isInvalidPassword } from "./qpdf-output";

describe("isInvalidPassword", () => {
  it("detects invalid password messages", () => {
    expect(
      isInvalidPassword("this.program: /job-1-in.pdf: invalid password"),
    ).toBe(true);
    expect(isInvalidPassword("something else")).toBe(false);
  });
});

describe("friendlyQpdfMessage", () => {
  it("has a fallback for empty output", () => {
    expect(friendlyQpdfMessage("")).toMatch(/could not process/);
  });

  it("explains files that are not PDFs", () => {
    expect(
      friendlyQpdfMessage(
        "WARNING: /job-1-in.pdf: can't find PDF header\nthis.program: /job-1-in.pdf: can't find startxref",
      ),
    ).toMatch(/valid PDF/);
  });

  it("names unsupported encryption and keeps qpdf's words", () => {
    expect(
      friendlyQpdfMessage("qpdf: /job-1-in.pdf: unsupported encryption V9"),
    ).toBe(
      "This PDF uses an encryption method that is not supported. (unsupported encryption V9)",
    );
  });

  it("strips the program and internal file names and capitalises", () => {
    expect(
      friendlyQpdfMessage("this.program: /job-2-x.pdf: something odd happened"),
    ).toBe("Something odd happened");
  });
});
