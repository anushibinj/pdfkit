import { describe, expect, it } from "vitest";
import { runQpdfJob, type QpdfJob } from "./qpdf-job";
import { FakeQpdfRunner } from "./test-utils/fake-qpdf";

const job: QpdfJob = {
  inputFile: "/in.pdf",
  outputFile: "/out.pdf",
  encrypt: { userPassword: '@a "b" --', ownerPassword: "o", "256bit": {} },
};

describe("runQpdfJob", () => {
  it("writes a page selection from an empty start as JSON", () => {
    const runner = new FakeQpdfRunner();
    const merge: QpdfJob = {
      empty: "",
      outputFile: "/out.pdf",
      pages: [
        { file: "/a.pdf", range: "1-z" },
        { file: "/b.pdf", password: "@--x", range: "1-z" },
      ],
    };
    runQpdfJob(runner, "/j.json", merge);
    expect(runner.jobs).toEqual([merge]);
  });

  it("writes the job as JSON and points qpdf at it", () => {
    const runner = new FakeQpdfRunner(() => ({ code: 0, stderr: "" }));
    const result = runQpdfJob(runner, "/j.json", job);
    expect(result).toEqual({ code: 0, stderr: "" });
    expect(runner.runs).toEqual([["--job-json-file=/j.json"]]);
    // the password survives JSON encoding exactly, quotes and all
    expect(runner.jobs).toEqual([job]);
  });

  it("returns qpdf's exit code and stderr", () => {
    const runner = new FakeQpdfRunner(() => ({ code: 2, stderr: "boom" }));
    expect(runQpdfJob(runner, "/j.json", job)).toEqual({
      code: 2,
      stderr: "boom",
    });
  });

  it("deletes the job file afterwards, because it holds passwords", () => {
    const runner = new FakeQpdfRunner();
    runQpdfJob(runner, "/j.json", job);
    expect(runner.exists("/j.json")).toBe(false);
  });

  it("deletes the job file even when qpdf throws", () => {
    const runner = new FakeQpdfRunner(() => {
      throw new Error("Aborted(OOM)");
    });
    expect(() => runQpdfJob(runner, "/j.json", job)).toThrow("OOM");
    expect(runner.exists("/j.json")).toBe(false);
  });

  it("encodes non-ASCII passwords as UTF-8 JSON", () => {
    const runner = new FakeQpdfRunner();
    const unicode: QpdfJob = { inputFile: "/in.pdf", password: "पासवर्ड🔐" };
    runQpdfJob(runner, "/j.json", unicode);
    expect(runner.jobs[0]).toEqual(unicode);
  });
});
