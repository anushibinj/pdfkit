import { describe, expect, it } from "vitest";
import type { QpdfRun } from "@/lib/qpdf/qpdf-runner";
import {
  FakeQpdfRunner,
  type RunScript,
} from "@/lib/qpdf/test-utils/fake-qpdf";
import {
  NOTHING_TO_MERGE_MESSAGE,
  NO_PAGES_MESSAGE,
  PdfMerger,
  UNCOUNTABLE_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
  describeMergeFailure,
  interpretPageCount,
} from "./pdf-merger";

const ok = (stdout: string, code = 0): QpdfRun => ({
  code,
  stderr: "",
  stdout,
});
const fail = (stderr: string): QpdfRun => ({ code: 2, stderr });

describe("interpretPageCount", () => {
  it("reads the count from stdout", () => {
    expect(interpretPageCount(ok("12\n"), false)).toEqual({
      kind: "inspected",
      pageCount: 12,
    });
  });

  it("accepts a count that came with warnings (exit code 3)", () => {
    expect(
      interpretPageCount({ code: 3, stderr: "WARNING: x", stdout: "4" }, false),
    ).toEqual({ kind: "inspected", pageCount: 4 });
  });

  it("tells a missing password from a wrong one", () => {
    const run = fail("qpdf: /job-1-in.pdf: invalid password");
    expect(interpretPageCount(run, false)).toEqual({
      kind: "password-required",
    });
    expect(interpretPageCount(run, true)).toEqual({ kind: "wrong-password" });
  });

  it("explains files that are not PDFs", () => {
    expect(
      interpretPageCount(
        fail("qpdf: /job-1-in.pdf: can't find startxref"),
        false,
      ),
    ).toEqual({
      kind: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });

  it("refuses a PDF without pages", () => {
    expect(interpretPageCount(ok("0"), false)).toEqual({
      kind: "failed",
      message: NO_PAGES_MESSAGE,
    });
  });

  it("does not guess when stdout holds no count", () => {
    for (const stdout of ["", "three", "-1", "2.5"]) {
      expect(interpretPageCount(ok(stdout), false)).toEqual({
        kind: "failed",
        message: UNCOUNTABLE_MESSAGE,
      });
    }
    // stdout not captured at all
    expect(interpretPageCount({ code: 0, stderr: "" }, false)).toEqual({
      kind: "failed",
      message: UNCOUNTABLE_MESSAGE,
    });
  });
});

describe("describeMergeFailure", () => {
  const paths = [
    "/job-2-a-in-0.pdf",
    "/job-2-a-in-1.pdf",
    "/job-2-a-in-10.pdf",
  ];

  it("names the file of the fatal (last) error, not earlier warnings", () => {
    const stderr = [
      "WARNING: /job-2-a-in-0.pdf: object 3 0 has an odd length",
      "WARNING: /job-2-a-in-1.pdf: can't find PDF header",
      "qpdf: /job-2-a-in-1.pdf: can't find startxref",
    ].join("\n");
    expect(describeMergeFailure(stderr, paths)).toEqual({
      message: "This does not look like a valid PDF file, or it is damaged.",
      sourceIndex: 1,
    });
  });

  it("does not confuse in-1.pdf with in-10.pdf", () => {
    expect(
      describeMergeFailure("qpdf: /job-2-a-in-10.pdf: bad thing", paths),
    ).toEqual({ message: "Bad thing", sourceIndex: 2 });
  });

  it("explains a wrong password", () => {
    expect(
      describeMergeFailure("qpdf: /job-2-a-in-0.pdf: invalid password", paths),
    ).toEqual({ message: WRONG_PASSWORD_MESSAGE, sourceIndex: 0 });
  });

  it("uses every line when no input is named", () => {
    expect(
      describeMergeFailure("qpdf: /job-2-a-out.pdf: disk full", paths),
    ).toEqual({ message: "Disk full" });
    expect(describeMergeFailure("", paths)).toEqual({
      message: "qpdf could not process this file.",
    });
  });
});

/** The job JSON qpdf was given in a run (the fake snapshots it). */
type Job = {
  inputFile?: string;
  outputFile?: string;
  password?: string;
  showNpages?: "";
  pages?: { file: string; password?: string; range: string }[];
};

/** A script that writes `output` (when the job names one) and answers `run`. */
function writingScript(
  run: QpdfRun,
  output = new Uint8Array([7, 7]),
): RunScript {
  return (args, files) => {
    const jobPath = args[0].slice("--job-json-file=".length);
    const job = JSON.parse(new TextDecoder().decode(files.get(jobPath))) as Job;
    if (job.outputFile && run.code !== 2) files.set(job.outputFile, output);
    return run;
  };
}

describe("PdfMerger.inspect", () => {
  it("counts pages through a job file, with the password, and cleans up", () => {
    const runner = new FakeQpdfRunner(writingScript(ok("3")));
    const merger = new PdfMerger(runner, () => "t");
    expect(merger.inspect(new Uint8Array([1]), "@-- pw")).toEqual({
      kind: "inspected",
      pageCount: 3,
    });
    expect(runner.runs).toEqual([["--job-json-file=/job-t-job.json"]]);
    expect(runner.jobs).toEqual([
      { inputFile: "/job-t-in.pdf", password: "@-- pw", showNpages: "" },
    ]);
    expect(runner.files.size).toBe(0);
  });

  it("treats an empty password as no password", () => {
    const runner = new FakeQpdfRunner(() => fail("invalid password"));
    const merger = new PdfMerger(runner, () => "t");
    expect(merger.inspect(new Uint8Array([1]), "")).toEqual({
      kind: "password-required",
    });
    expect(runner.jobs[0]).not.toHaveProperty("password");
  });

  it("cleans up when qpdf crashes", () => {
    const runner = new FakeQpdfRunner(() => {
      throw new RangeError("Array buffer allocation failed");
    });
    const merger = new PdfMerger(runner, () => "t");
    expect(() => merger.inspect(new Uint8Array([1]))).toThrow(RangeError);
    expect(runner.files.size).toBe(0);
  });
});

describe("PdfMerger.merge", () => {
  it("merges every source in order with its password, and cleans up", () => {
    const runner = new FakeQpdfRunner(writingScript(ok("")));
    const merger = new PdfMerger(runner, () => "t");
    const outcome = merger.merge([
      { bytes: new Uint8Array([1]) },
      { bytes: new Uint8Array([2]), password: "x" },
    ]);
    expect(outcome).toEqual({
      kind: "merged",
      pdf: new Uint8Array([7, 7]),
      warnings: undefined,
    });
    expect(runner.jobs).toEqual([
      {
        empty: "",
        outputFile: "/job-t-out.pdf",
        pages: [
          { file: "/job-t-in-0.pdf", range: "1-z" },
          { file: "/job-t-in-1.pdf", password: "x", range: "1-z" },
        ],
      },
    ]);
    expect(runner.files.size).toBe(0);
  });

  it("keeps warnings from a merge that exited with code 3", () => {
    const runner = new FakeQpdfRunner(
      writingScript({ code: 3, stderr: "WARNING: /job-t-in-0.pdf: repaired" }),
    );
    expect(
      new PdfMerger(runner, () => "t").merge([{ bytes: new Uint8Array([1]) }]),
    ).toMatchObject({ kind: "merged", warnings: "Repaired" });
  });

  it("reports the failing source", () => {
    const runner = new FakeQpdfRunner(
      writingScript(fail("qpdf: /job-t-in-1.pdf: can't find startxref")),
    );
    expect(
      new PdfMerger(runner, () => "t").merge([
        { bytes: new Uint8Array([1]) },
        { bytes: new Uint8Array([2]) },
      ]),
    ).toEqual({
      kind: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
      sourceIndex: 1,
    });
    expect(runner.files.size).toBe(0);
  });

  it("never returns a missing output, even after exit code 0", () => {
    const runner = new FakeQpdfRunner(() => ok(""));
    expect(
      new PdfMerger(runner, () => "t").merge([{ bytes: new Uint8Array([1]) }]),
    ).toMatchObject({ kind: "failed" });
  });

  it("answers an empty merge with a failure, without running qpdf", () => {
    const runner = new FakeQpdfRunner();
    expect(new PdfMerger(runner, () => "t").merge([])).toEqual({
      kind: "failed",
      message: NOTHING_TO_MERGE_MESSAGE,
    });
    expect(runner.runs).toEqual([]);
    expect(runner.files.size).toBe(0);
  });
});
