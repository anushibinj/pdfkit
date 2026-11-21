import { describe, expect, it, vi } from "vitest";
import type {
  QpdfCommands,
  QpdfRunResult,
  QpdfWorkspace,
} from "@/lib/qpdf/qpdf-runner";
import {
  QpdfMerger,
  describeMergeFailure,
  interpretPageCount,
} from "./qpdf-merger";

const ok = (stdout: string, code = 0): QpdfRunResult => ({
  code,
  stdout,
  stderr: "",
});
const fail = (stderr: string): QpdfRunResult => ({
  code: 2,
  stdout: "",
  stderr,
});

describe("interpretPageCount", () => {
  it("reads the count from stdout", () => {
    expect(interpretPageCount(ok("12\n"), false)).toEqual({
      status: "inspected",
      pageCount: 12,
    });
  });

  it("accepts a count that came with warnings (exit code 3)", () => {
    expect(
      interpretPageCount(
        { code: 3, stdout: "4", stderr: "WARNING: repaired" },
        false,
      ),
    ).toEqual({ status: "inspected", pageCount: 4 });
  });

  it("tells a missing password from a wrong one", () => {
    const res = fail("qpdf: /job-1-in.pdf: invalid password");
    expect(interpretPageCount(res, false)).toEqual({
      status: "password-required",
    });
    expect(interpretPageCount(res, true)).toEqual({ status: "wrong-password" });
  });

  it("explains files that are not PDFs", () => {
    expect(
      interpretPageCount(
        fail("qpdf: /job-1-in.pdf: can't find startxref"),
        false,
      ),
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });

  it("refuses a PDF without pages", () => {
    expect(interpretPageCount(ok("0"), false)).toMatchObject({
      status: "error",
      message: "This PDF has no pages.",
    });
  });

  it("does not guess when stdout holds no count", () => {
    for (const stdout of ["", "three", "-1", "2.5"]) {
      expect(interpretPageCount(ok(stdout), false)).toMatchObject({
        status: "error",
        message: "Could not count the pages of this PDF.",
      });
    }
  });
});

describe("describeMergeFailure", () => {
  const paths = ["/job-2-in-0.pdf", "/job-2-in-1.pdf", "/job-2-in-10.pdf"];

  it("names the file of the fatal (last) error, not earlier warnings", () => {
    const stderr = [
      "WARNING: /job-2-in-0.pdf: object 3 0 has an odd length",
      "WARNING: /job-2-in-1.pdf: can't find PDF header",
      "qpdf: /job-2-in-1.pdf: can't find startxref",
    ].join("\n");
    expect(describeMergeFailure(stderr, paths)).toEqual({
      message: "This does not look like a valid PDF file, or it is damaged.",
      sourceIndex: 1,
    });
  });

  it("does not confuse in-1.pdf with in-10.pdf", () => {
    expect(
      describeMergeFailure("qpdf: /job-2-in-10.pdf: bad thing", paths),
    ).toEqual({ message: "Bad thing", sourceIndex: 2 });
  });

  it("explains a wrong password", () => {
    expect(
      describeMergeFailure("qpdf: /job-2-in-0.pdf: invalid password", paths),
    ).toEqual({
      message: "The password for this file is wrong.",
      sourceIndex: 0,
    });
  });

  it("uses every line when no input is named", () => {
    expect(
      describeMergeFailure("qpdf: /job-2-out.pdf: disk full", paths),
    ).toEqual({ message: "Disk full" });
    expect(describeMergeFailure("", paths)).toEqual({
      message: "qpdf could not process this file.",
    });
  });
});

/** A fake qpdf whose virtual files live in a Map. */
function fakeQpdf(answer: QpdfRunResult, writesOutput = true) {
  const files = new Map<string, Uint8Array>();
  const disposed: string[][] = [];
  const qpdf: QpdfCommands = {
    run: vi.fn((args: readonly string[]) => {
      const out = args[args.length - 1];
      if (writesOutput && answer.code !== 2 && out.endsWith("out.pdf")) {
        files.set(out, new Uint8Array([7, 7]));
      }
      return answer;
    }),
    withJob: (fn) => {
      const job: QpdfWorkspace = {
        path: (name) => `/job-9-${name}`,
        write: (name, bytes) => {
          files.set(`/job-9-${name}`, bytes);
          return `/job-9-${name}`;
        },
        read: (name) => files.get(`/job-9-${name}`)!,
        exists: (name) => files.has(`/job-9-${name}`),
      };
      try {
        return fn(job);
      } finally {
        disposed.push([...files.keys()]);
        files.clear();
      }
    },
  };
  return { qpdf, disposed };
}

describe("QpdfMerger", () => {
  it("counts pages of a file written into its own job", () => {
    const { qpdf, disposed } = fakeQpdf(ok("3"));
    const bytes = new Uint8Array([1]);
    expect(new QpdfMerger(qpdf).inspect({ bytes, password: "pw" })).toEqual({
      status: "inspected",
      pageCount: 3,
    });
    expect(qpdf.run).toHaveBeenCalledWith([
      "--show-npages",
      "--password=pw",
      "/job-9-in.pdf",
    ]);
    expect(disposed).toEqual([["/job-9-in.pdf"]]);
  });

  it("treats an empty password as no password when inspecting", () => {
    const { qpdf } = fakeQpdf(fail("invalid password"));
    expect(
      new QpdfMerger(qpdf).inspect({ bytes: new Uint8Array(), password: "" }),
    ).toEqual({ status: "password-required" });
  });

  it("merges every source into one output and returns its bytes", () => {
    const { qpdf, disposed } = fakeQpdf(ok(""));
    const merger = new QpdfMerger(qpdf);
    const outcome = merger.merge([
      { bytes: new Uint8Array([1]) },
      { bytes: new Uint8Array([2]), password: "x" },
    ]);
    expect(qpdf.run).toHaveBeenCalledWith([
      "--empty",
      "--pages",
      "/job-9-in-0.pdf",
      "1-z",
      "/job-9-in-1.pdf",
      "--password=x",
      "1-z",
      "--",
      "/job-9-out.pdf",
    ]);
    expect(outcome).toEqual({
      status: "merged",
      bytes: new Uint8Array([7, 7]),
      warnings: undefined,
    });
    // inputs and output were all handed to the job for cleanup
    expect(disposed[0].sort()).toEqual([
      "/job-9-in-0.pdf",
      "/job-9-in-1.pdf",
      "/job-9-out.pdf",
    ]);
  });

  it("keeps warnings from a merge that exited with code 3", () => {
    const { qpdf } = fakeQpdf({
      code: 3,
      stdout: "",
      stderr: "WARNING: /job-9-in-0.pdf: repaired",
    });
    expect(
      new QpdfMerger(qpdf).merge([{ bytes: new Uint8Array([1]) }]),
    ).toMatchObject({ status: "merged", warnings: "Repaired" });
  });

  it("reports the failing source", () => {
    const { qpdf } = fakeQpdf(
      fail("qpdf: /job-9-in-1.pdf: can't find startxref"),
    );
    expect(
      new QpdfMerger(qpdf).merge([
        { bytes: new Uint8Array([1]) },
        { bytes: new Uint8Array([2]) },
      ]),
    ).toEqual({
      status: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
      sourceIndex: 1,
    });
  });

  it("never returns a missing output, even after exit code 0", () => {
    const { qpdf } = fakeQpdf(ok(""), false);
    expect(
      new QpdfMerger(qpdf).merge([{ bytes: new Uint8Array([1]) }]),
    ).toMatchObject({ status: "failed" });
  });
});
