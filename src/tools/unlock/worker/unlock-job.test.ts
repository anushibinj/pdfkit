import { describe, expect, it, vi } from "vitest";
import type {
  QpdfCommands,
  QpdfRunResult,
  QpdfWorkspace,
} from "@/lib/qpdf/qpdf-runner";
import { unlockPdf } from "./unlock-job";

/**
 * A qpdf stand-in: `answers` are returned by successive `run` calls, and the
 * output file "exists" only when `outputExists` says so.
 */
function fakeQpdf(answers: QpdfRunResult[], outputExists = true) {
  const files = new Map<string, Uint8Array>();
  const job: QpdfWorkspace = {
    path: (name) => `/job-1-${name}`,
    write: (name, bytes) => {
      files.set(name, bytes);
      return `/job-1-${name}`;
    },
    read: () => new Uint8Array([37, 80, 68, 70]),
    exists: (name) => (name === "out.pdf" ? outputExists : files.has(name)),
  };
  const qpdf: QpdfCommands = {
    run: vi.fn(() => {
      const next = answers.shift();
      if (!next) throw new Error("unexpected qpdf call");
      return next;
    }),
    withJob: (fn) => fn(job),
  };
  return qpdf;
}

const data = new Uint8Array([1, 2, 3]).buffer;

describe("unlockPdf", () => {
  it("probes, then decrypts without a password for owner-only files", () => {
    const qpdf = fakeQpdf([
      { code: 3, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const result = unlockPdf(qpdf, { data });
    expect(qpdf.run).toHaveBeenNthCalledWith(1, [
      "--requires-password",
      "/job-1-in.pdf",
    ]);
    expect(qpdf.run).toHaveBeenNthCalledWith(2, [
      "--decrypt",
      "/job-1-in.pdf",
      "/job-1-out.pdf",
    ]);
    expect(result).toMatchObject({ status: "unlocked", via: "owner" });
    if (result.status !== "unlocked") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(result.data))).toEqual([37, 80, 68, 70]);
    expect(result.warnings).toBeUndefined();
  });

  it("skips the probe and passes the password on a retry", () => {
    const qpdf = fakeQpdf([{ code: 0, stdout: "", stderr: "" }]);
    expect(unlockPdf(qpdf, { data, password: "pw" })).toMatchObject({
      status: "unlocked",
      via: "password",
    });
    expect(qpdf.run).toHaveBeenCalledWith([
      "--decrypt",
      "--password=pw",
      "/job-1-in.pdf",
      "/job-1-out.pdf",
    ]);
  });

  it("asks for a password when the probe exits with 0", () => {
    const qpdf = fakeQpdf([{ code: 0, stdout: "", stderr: "" }]);
    expect(unlockPdf(qpdf, { data })).toEqual({ status: "password-required" });
  });

  it("reports a damaged file found by the probe", () => {
    const qpdf = fakeQpdf([
      { code: 2, stdout: "", stderr: "qpdf: /job-1-in.pdf: weird thing" },
    ]);
    expect(unlockPdf(qpdf, { data })).toEqual({
      status: "error",
      reason: "failed",
      message: "Weird thing",
    });
  });

  it("keeps warnings from a decryption that succeeded with exit code 3", () => {
    const qpdf = fakeQpdf([
      { code: 3, stdout: "", stderr: "WARNING: /job-1-in.pdf: repaired xref" },
    ]);
    const result = unlockPdf(qpdf, { data, password: "pw" });
    expect(result).toMatchObject({
      status: "unlocked",
      warnings: "Repaired xref",
    });
  });

  it("never offers a missing output file, even after exit code 0", () => {
    const qpdf = fakeQpdf([{ code: 0, stdout: "", stderr: "" }], false);
    expect(unlockPdf(qpdf, { data, password: "pw" })).toMatchObject({
      status: "error",
      reason: "failed",
    });
  });

  it("lets unexpected exceptions through for the handler", () => {
    const qpdf = fakeQpdf([]);
    vi.mocked(qpdf.run).mockImplementation(() => {
      throw new RangeError("Array buffer allocation failed");
    });
    expect(() => unlockPdf(qpdf, { data })).toThrow(RangeError);
  });
});
