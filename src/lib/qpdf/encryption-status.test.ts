import { describe, expect, it } from "vitest";
import { probeEncryption } from "./encryption-status";
import { FakeQpdfRunner } from "./test-utils/fake-qpdf";

const probe = (code: number, stderr = "") =>
  probeEncryption(new FakeQpdfRunner(() => ({ code, stderr })), "/in.pdf");

describe("probeEncryption", () => {
  it("asks qpdf whether the file requires a password", () => {
    const runner = new FakeQpdfRunner(() => ({ code: 2, stderr: "" }));
    probeEncryption(runner, "/job-1-in.pdf");
    expect(runner.runs).toEqual([["--requires-password", "/job-1-in.pdf"]]);
  });

  it("exit 3: encrypted but opens without a password", () => {
    expect(probe(3)).toEqual({ kind: "opens-without-password" });
  });

  it("exit 0: a password is required (documented behaviour)", () => {
    expect(probe(0)).toEqual({ kind: "password-required" });
  });

  it("exit 2 with 'invalid password': a password is required (qpdf 11.0.0)", () => {
    expect(probe(2, "this.program: /job-1-in.pdf: invalid password")).toEqual({
      kind: "password-required",
    });
  });

  it("silent exit 2: not encrypted", () => {
    expect(probe(2)).toEqual({ kind: "not-encrypted" });
    expect(probe(2, "  \n")).toEqual({ kind: "not-encrypted" });
  });

  it("exit 2 with another message: unreadable, with a friendly message", () => {
    expect(
      probe(2, "this.program: /job-1-in.pdf: can't find startxref"),
    ).toEqual({
      kind: "unreadable",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });
});
