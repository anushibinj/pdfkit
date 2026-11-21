import { describe, expect, it } from "vitest";
import { FakeQpdfRunner } from "@/lib/qpdf/test-utils/fake-qpdf";
import {
  ALL_PAGES,
  mergeJob,
  mergeScratchFiles,
  pageCountJob,
  removeMergeScratchFiles,
} from "./merge-jobs";

describe("mergeScratchFiles", () => {
  it("names one input per source, plus the usual output and job files", () => {
    expect(mergeScratchFiles("7-abc", 3)).toEqual({
      inputs: [
        "/job-7-abc-in-0.pdf",
        "/job-7-abc-in-1.pdf",
        "/job-7-abc-in-2.pdf",
      ],
      output: "/job-7-abc-out.pdf",
      job: "/job-7-abc-job.json",
    });
  });
});

describe("removeMergeScratchFiles", () => {
  it("deletes every file of the merge and ignores missing ones", () => {
    const runner = new FakeQpdfRunner();
    const files = mergeScratchFiles("1-x", 2);
    runner.writeFile(files.inputs[0], new Uint8Array([1]));
    runner.writeFile(files.output, new Uint8Array([2]));
    runner.writeFile("/unrelated.pdf", new Uint8Array([3]));
    removeMergeScratchFiles(runner, files);
    expect([...runner.files.keys()]).toEqual(["/unrelated.pdf"]);
  });
});

describe("pageCountJob", () => {
  it("asks for the page count", () => {
    expect(pageCountJob("/in.pdf")).toEqual({
      inputFile: "/in.pdf",
      showNpages: "",
    });
  });

  it("passes a password, and leaves an empty one out", () => {
    expect(pageCountJob("/in.pdf", "@-- pw")).toEqual({
      inputFile: "/in.pdf",
      password: "@-- pw",
      showNpages: "",
    });
    expect(pageCountJob("/in.pdf", "")).not.toHaveProperty("password");
  });
});

describe("mergeJob", () => {
  it("takes every page of every file, in order, into an empty document", () => {
    expect(
      mergeJob(
        [{ path: "/a.pdf" }, { path: "/b.pdf", password: "x" }],
        "/out.pdf",
      ),
    ).toEqual({
      empty: "",
      outputFile: "/out.pdf",
      pages: [
        { file: "/a.pdf", range: "1-z" },
        { file: "/b.pdf", password: "x", range: "1-z" },
      ],
    });
  });

  it("leaves an empty password out", () => {
    const job = mergeJob([{ path: "/a.pdf", password: "" }], "/out.pdf");
    expect(job.pages?.[0]).toEqual({ file: "/a.pdf", range: ALL_PAGES });
  });

  it("always writes the page range out", () => {
    expect(ALL_PAGES).toBe("1-z");
  });

  it("refuses an empty input list", () => {
    expect(() => mergeJob([], "/out.pdf")).toThrow("Nothing to merge");
  });
});
