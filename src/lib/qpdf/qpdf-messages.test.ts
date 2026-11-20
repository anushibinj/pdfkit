import { describe, expect, it } from "vitest";
import { friendlyQpdfMessage, isInvalidPassword } from "./qpdf-messages";

describe("isInvalidPassword", () => {
  it("detects invalid password messages", () => {
    expect(
      isInvalidPassword("this.program: /job-1-in.pdf: invalid password"),
    ).toBe(true);
    expect(isInvalidPassword("qpdf: /job-1-in-0.pdf: Invalid Password")).toBe(
      true,
    );
  });

  it("ignores other failures", () => {
    expect(isInvalidPassword("something else")).toBe(false);
    expect(isInvalidPassword("")).toBe(false);
  });
});

describe("friendlyQpdfMessage", () => {
  it("has a fallback for empty stderr", () => {
    expect(friendlyQpdfMessage("")).toMatch(/could not process/);
    expect(friendlyQpdfMessage("\n  \n")).toMatch(/could not process/);
  });

  it("explains files that are not PDFs", () => {
    expect(
      friendlyQpdfMessage(
        "WARNING: /job-1-in.pdf: can't find PDF header\nthis.program: /job-1-in.pdf: can't find startxref",
      ),
    ).toMatch(/valid PDF/);
  });

  it("explains unsupported encryption and keeps the details", () => {
    expect(
      friendlyQpdfMessage("qpdf: /job-1-in.pdf: unsupported encryption filter"),
    ).toBe(
      "This PDF uses an encryption method that is not supported. (unsupported encryption filter)",
    );
  });

  it("strips the program prefix and the virtual file name", () => {
    expect(
      friendlyQpdfMessage("this.program: /job-2-x.pdf: something odd happened"),
    ).toBe("Something odd happened");
    // merge jobs name their inputs in-0.pdf, in-1.pdf, ...
    expect(friendlyQpdfMessage("qpdf: /job-7-in-12.pdf: odd")).toBe("Odd");
  });
});
