import { describe, expect, it } from "vitest";
import type { QpdfJob } from "@/lib/qpdf/qpdf-job";
import type { QpdfRun } from "@/lib/qpdf/qpdf-runner";
import { FakeQpdfRunner } from "@/lib/qpdf/test-utils/fake-qpdf";
import { PdfProtector, VERIFICATION_FAILED_MESSAGE } from "./pdf-protector";

const INPUT = "/job-t-in.pdf";
const OUTPUT = "/job-t-out.pdf";
const ENCRYPTED = new Uint8Array([37, 80, 68, 70, 9]);

interface Script {
  /** `--requires-password` on the input. Default: not encrypted. */
  inputProbe?: QpdfRun;
  /** The encryption job. Default: success. */
  encrypt?: QpdfRun;
  /** Whether the encryption job writes the output file. */
  writesOutput?: boolean;
  /** `--requires-password` on the output. Default: password required. */
  outputProbe?: QpdfRun;
  /** The password check job. Default: the password opens it (exit 3). */
  check?: QpdfRun;
}

/** A fake qpdf that plays one protection job according to `script`. */
function fakeQpdf(script: Script = {}) {
  const runner: FakeQpdfRunner = new FakeQpdfRunner((args, files) => {
    if (args[0] === "--requires-password") {
      return args[1] === INPUT
        ? (script.inputProbe ?? { code: 2, stderr: "" })
        : (script.outputProbe ?? { code: 2, stderr: "invalid password" });
    }
    const job = runner.jobs.at(-1) as QpdfJob;
    if (job.encrypt) {
      if (script.writesOutput ?? true) files.set(OUTPUT, ENCRYPTED);
      return script.encrypt ?? { code: 0, stderr: "" };
    }
    return script.check ?? { code: 3, stderr: "" };
  });
  return { runner, protector: new PdfProtector(runner, () => "t") };
}

const pdf = new Uint8Array([37, 80, 68, 70]);

describe("PdfProtector.protect", () => {
  it("encrypts an unencrypted PDF, verifies it and returns the bytes", () => {
    const { runner, protector } = fakeQpdf();
    expect(protector.protect(pdf, "s3cret")).toEqual({
      kind: "protected",
      pdf: ENCRYPTED,
      replacedRestrictions: false,
      warnings: undefined,
    });
    // probe input, encrypt, probe output, check the password
    expect(runner.runs).toEqual([
      ["--requires-password", INPUT],
      ["--job-json-file=/job-t-job.json"],
      ["--requires-password", OUTPUT],
      ["--job-json-file=/job-t-job.json"],
    ]);
    expect(runner.jobs).toEqual([
      {
        inputFile: INPUT,
        outputFile: OUTPUT,
        encrypt: {
          userPassword: "s3cret",
          ownerPassword: "s3cret",
          "256bit": {},
        },
      },
      {
        inputFile: OUTPUT,
        password: "s3cret",
        suppressPasswordRecovery: "",
        requiresPassword: "",
      },
    ]);
  });

  it("writes the input bytes for qpdf to read", () => {
    let seen: Uint8Array | undefined;
    const runner = new FakeQpdfRunner((args, files) => {
      seen ??= files.get(INPUT);
      return { code: 2, stderr: "invalid password" };
    });
    new PdfProtector(runner, () => "t").protect(pdf, "x");
    expect(Array.from(seen ?? [])).toEqual(Array.from(pdf));
  });

  it("removes every scratch file afterwards", () => {
    const { runner, protector } = fakeQpdf();
    protector.protect(pdf, "s3cret");
    expect(runner.files.size).toBe(0);
  });

  it("reports that restrictions were replaced when the input had them", () => {
    const { protector } = fakeQpdf({ inputProbe: { code: 3, stderr: "" } });
    expect(protector.protect(pdf, "s3cret")).toMatchObject({
      kind: "protected",
      replacedRestrictions: true,
    });
  });

  it("passes on qpdf's warnings (exit 3)", () => {
    const { protector } = fakeQpdf({
      encrypt: { code: 3, stderr: "WARNING: /job-t-in.pdf: file is damaged" },
    });
    expect(protector.protect(pdf, "s3cret")).toMatchObject({
      kind: "protected",
      warnings: "File is damaged",
    });
  });

  it("leaves a PDF that already needs a password alone", () => {
    const { runner, protector } = fakeQpdf({
      inputProbe: { code: 2, stderr: "invalid password" },
    });
    expect(protector.protect(pdf, "s3cret")).toEqual({
      kind: "already-protected",
    });
    expect(runner.runs).toHaveLength(1);
    expect(runner.files.size).toBe(0);
  });

  it("explains a file qpdf cannot read", () => {
    const { protector } = fakeQpdf({
      inputProbe: {
        code: 2,
        stderr: "qpdf: /job-t-in.pdf: can't find startxref",
      },
    });
    expect(protector.protect(pdf, "s3cret")).toEqual({
      kind: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });

  it("explains an encryption failure", () => {
    const { protector } = fakeQpdf({
      encrypt: { code: 2, stderr: "qpdf: /job-t-in.pdf: something odd" },
      writesOutput: false,
    });
    expect(protector.protect(pdf, "s3cret")).toEqual({
      kind: "failed",
      message: "Something odd",
    });
  });

  it("fails when qpdf reports success but wrote no file", () => {
    const { protector } = fakeQpdf({ writesOutput: false });
    expect(protector.protect(pdf, "s3cret")).toMatchObject({ kind: "failed" });
  });

  it("refuses to hand over a result that opens without a password", () => {
    const { protector } = fakeQpdf({ outputProbe: { code: 3, stderr: "" } });
    expect(protector.protect(pdf, "s3cret")).toEqual({
      kind: "failed",
      message: VERIFICATION_FAILED_MESSAGE,
    });
  });

  it("refuses to hand over a result the password does not open", () => {
    const { protector } = fakeQpdf({
      check: { code: 2, stderr: "invalid password" },
    });
    expect(protector.protect(pdf, "s3cret")).toEqual({
      kind: "failed",
      message: VERIFICATION_FAILED_MESSAGE,
    });
  });

  it.each([
    ["", "Enter a password."],
    ["x".repeat(128), /too long/],
    ["a\u0000b", /control character/],
  ])("refuses the password %j before touching qpdf", (password, message) => {
    const { runner, protector } = fakeQpdf();
    const outcome = protector.protect(pdf, password);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.message).toMatch(message);
    expect(runner.runs).toHaveLength(0);
    expect(runner.files.size).toBe(0);
  });

  it("lets a qpdf crash propagate and still cleans up", () => {
    const runner = new FakeQpdfRunner(() => {
      throw new Error("Aborted(OOM)");
    });
    expect(() => new PdfProtector(runner, () => "t").protect(pdf, "x")).toThrow(
      "OOM",
    );
    expect(runner.files.size).toBe(0);
  });

  it("uses a fresh file name for every job by default", () => {
    const runner = new FakeQpdfRunner(() => ({
      code: 2,
      stderr: "invalid password",
    }));
    const protector = new PdfProtector(runner);
    protector.protect(pdf, "x");
    protector.protect(pdf, "x");
    expect(runner.runs[0][1]).not.toBe(runner.runs[1][1]);
  });
});
