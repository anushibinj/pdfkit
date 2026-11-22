import { describe, expect, it } from "vitest";
import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "./qpdf-output";

describe("qpdf exit codes", () => {
  it("match qpdf's documented values", () => {
    expect([EXIT_OK, EXIT_ERROR, EXIT_WARNINGS]).toEqual([0, 2, 3]);
  });
});

describe("isInvalidPassword", () => {
  it("detects qpdf's invalid password message in any case", () => {
    expect(
      isInvalidPassword("this.program: /job-1-in.pdf: invalid password"),
    ).toBe(true);
    expect(isInvalidPassword("Invalid Password")).toBe(true);
  });

  it("ignores other messages", () => {
    expect(isInvalidPassword("something else")).toBe(false);
    expect(isInvalidPassword("")).toBe(false);
  });
});

describe("friendlyQpdfMessage", () => {
  it("has a fallback for empty output", () => {
    expect(friendlyQpdfMessage("")).toBe("qpdf could not process this file.");
    expect(friendlyQpdfMessage("\n  \n")).toBe(
      "qpdf could not process this file.",
    );
  });

  it("explains files that are not PDFs", () => {
    expect(
      friendlyQpdfMessage(
        "WARNING: /job-1-in.pdf: can't find PDF header\nthis.program: /job-1-in.pdf: can't find startxref",
      ),
    ).toBe("This does not look like a valid PDF file, or it is damaged.");
  });

  it("explains unsupported encryption and keeps the detail", () => {
    expect(
      friendlyQpdfMessage("qpdf: /job-3-ab-in.pdf: unsupported encryption V=9"),
    ).toBe(
      "This PDF uses an encryption method that is not supported. (unsupported encryption V=9)",
    );
  });

  it("strips any internal file path, with qpdf's byte offset", () => {
    expect(
      friendlyQpdfMessage(
        "qpdf: /job-1-in.pdf (offset 1234): object 7 0 has unexpected xref entry type",
      ),
    ).toBe("Object 7 0 has unexpected xref entry type");
    expect(
      friendlyQpdfMessage("qpdf: /watermark-source.pdf: file is damaged"),
    ).toBe("File is damaged");
  });

  it("strips program and scratch-file prefixes and capitalises", () => {
    expect(
      friendlyQpdfMessage("this.program: /job-2-x.pdf: something odd happened"),
    ).toBe("Something odd happened");
  });
});
