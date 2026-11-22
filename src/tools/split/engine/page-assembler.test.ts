import { describe, expect, it, vi } from "vitest";
import type { QpdfJob } from "@/lib/qpdf/qpdf-job";
import type { QpdfRun } from "@/lib/qpdf/qpdf-runner";
import { FakeQpdfRunner } from "@/lib/qpdf/test-utils/fake-qpdf";
import {
  AssemblyError,
  PageAssembler,
  WrongPasswordError,
  copyPagesJob,
} from "./page-assembler";

/** A "PDF" for the fake: its password and the labels of its pages. */
interface FakePdf {
  password: string;
  pages: string[];
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes));

/** Knobs a test can turn on the fake qpdf. */
interface FakeControls {
  /** Make the next run return this instead of doing the job. */
  nextResult: QpdfRun | null;
  /** Warn (exit 3) whenever this page is copied. */
  warnOn: string | null;
}

/**
 * A fake qpdf that does what the assembler's job asks: open `inputFile`
 * with `password`, take the pages of "." given by `range` (1-based, like
 * qpdf), and write them to `outputFile`, keeping the password (as qpdf
 * keeps the primary file's encryption).
 */
function fakeQpdf() {
  const controls: FakeControls = { nextResult: null, warnOn: null };
  const qpdf = new FakeQpdfRunner((args, files) => {
    if (controls.nextResult) {
      const result = controls.nextResult;
      controls.nextResult = null;
      return result;
    }
    const jobPath = args[0].slice("--job-json-file=".length);
    const job = decode<QpdfJob & { inputFile: string }>(files.get(jobPath)!);
    const pdf = decode<FakePdf>(files.get(job.inputFile)!);
    if (pdf.password !== (job.password ?? "")) {
      return { code: 2, stderr: `qpdf: ${job.inputFile}: invalid password` };
    }
    expect(job.pages).toHaveLength(1);
    expect(job.pages![0].file).toBe(".");
    const pages: string[] = [];
    for (const item of job.pages![0].range.split(",")) {
      const [a, b = a] = item.split("-").map(Number);
      expect(a).toBeLessThanOrEqual(b); // never a backwards run
      for (let p = a; p <= b; p++) {
        if (p < 1 || p > pdf.pages.length) {
          return { code: 2, stderr: `qpdf: number ${p} out of range` };
        }
        pages.push(pdf.pages[p - 1]);
      }
    }
    files.set(job.outputFile!, encode({ password: pdf.password, pages }));
    if (controls.warnOn && pages.includes(controls.warnOn)) {
      return {
        code: 3,
        stderr: `WARNING: ${job.inputFile}: repaired page ${controls.warnOn}`,
      };
    }
    return { code: 0, stderr: "" };
  });
  return { qpdf, controls };
}

const labels = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function setup(pages = 5, password = "") {
  const { qpdf, controls } = fakeQpdf();
  let calls = 0;
  const assembler = new PageAssembler(qpdf, () => `t${++calls}`);
  const source = encode({ password, pages: labels(pages) });
  return { qpdf, controls, assembler, source };
}

const pagesOf = (files: Uint8Array[]) => files.map((f) => decode<FakePdf>(f).pages);

describe("copyPagesJob", () => {
  it("copies pages of the primary file, so its document data is kept", () => {
    expect(copyPagesJob("/in.pdf", "", [0, 1, 2, 4], "/out.pdf")).toEqual({
      inputFile: "/in.pdf",
      pages: [{ file: ".", range: "1-3,5" }],
      outputFile: "/out.pdf",
    });
  });

  it("adds the password only when there is one", () => {
    expect(copyPagesJob("/in.pdf", "pw", [3], "/out.pdf")).toMatchObject({
      password: "pw",
      pages: [{ file: ".", range: "4" }],
    });
  });
});

describe("PageAssembler", () => {
  it("makes each output with one copy job and returns them in plan order", () => {
    const { qpdf, assembler, source } = setup(5);
    const result = assembler.assemble(source, "", 5, [[0, 1, 2], [4], [3]]);
    expect(pagesOf(result.files)).toEqual([["p1", "p2", "p3"], ["p5"], ["p4"]]);
    expect(result.warnings).toEqual([]);
    expect(qpdf.jobs[0]).toEqual({
      inputFile: "/job-t1-in.pdf",
      pages: [{ file: ".", range: "1-3" }],
      outputFile: "/job-t1-out.pdf",
    });
  });

  it("passes the password in the job and the outputs keep it", () => {
    const { qpdf, assembler, source } = setup(3, "hunter2");
    const result = assembler.assemble(source, "hunter2", 3, [[1]]);
    expect(qpdf.jobs[0]).toMatchObject({ password: "hunter2" });
    expect(qpdf.runs[0]).toEqual(["--job-json-file=/job-t1-job.json"]);
    expect(decode<FakePdf>(result.files[0])).toEqual({
      password: "hunter2",
      pages: ["p2"],
    });
  });

  it("goes through parts for many outputs and gets the same files", () => {
    const { qpdf, assembler, source } = setup(100);
    const outputs = Array.from({ length: 100 }, (_, i) => [i]);
    const result = assembler.assemble(source, "", 100, outputs);
    expect(pagesOf(result.files)).toEqual(labels(100).map((l) => [l]));
    // 10 parts from the source + 100 outputs from parts
    const fromSource = (qpdf.jobs as { inputFile: string }[]).filter((j) =>
      j.inputFile.endsWith("-in.pdf"),
    );
    expect(fromSource).toHaveLength(10);
    expect(qpdf.jobs).toHaveLength(110);
  });

  it("keeps the password through parts", () => {
    const { assembler, source } = setup(20, "pw");
    const outputs = Array.from({ length: 20 }, (_, i) => [i]);
    const result = assembler.assemble(source, "pw", 20, outputs);
    expect(result.files.every((f) => decode<FakePdf>(f).password === "pw")).toBe(true);
  });

  it("reports progress after each output", () => {
    const { assembler, source } = setup(3);
    const onProgress = vi.fn();
    assembler.assemble(source, "", 3, [[0], [1], [2]], onProgress);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("collects distinct warnings and still returns the files", () => {
    const { controls, assembler, source } = setup(3);
    controls.warnOn = "p2";
    const result = assembler.assemble(source, "", 3, [[0, 1], [1], [2]]);
    expect(result.files).toHaveLength(3);
    expect(result.warnings).toEqual(["Repaired page p2"]);
  });

  it("throws WrongPasswordError when qpdf refuses the password", () => {
    const { assembler, source } = setup(3, "right");
    expect(() => assembler.assemble(source, "wrong", 3, [[0]])).toThrow(
      WrongPasswordError,
    );
  });

  it("throws a readable AssemblyError when qpdf fails", () => {
    const { controls, assembler, source } = setup(3);
    controls.nextResult = {
      code: 2,
      stderr: "qpdf: /job-t1-in.pdf: can't find startxref",
    };
    expect(() => assembler.assemble(source, "", 3, [[0]])).toThrow(
      new AssemblyError("This does not look like a valid PDF file, or it is damaged."),
    );
  });

  it("treats a missing output as a failure even with exit code 0", () => {
    const { controls, assembler, source } = setup(3);
    controls.nextResult = { code: 0, stderr: "" };
    expect(() => assembler.assemble(source, "", 3, [[0]])).toThrow(AssemblyError);
  });

  it("deletes every file, job JSON included, after success and after failure", () => {
    const { qpdf, controls, assembler, source } = setup(30, "pw");
    assembler.assemble(source, "pw", 30, Array.from({ length: 30 }, (_, i) => [i]));
    expect([...qpdf.files.keys()]).toEqual([]);
    controls.nextResult = { code: 2, stderr: "boom" };
    expect(() => assembler.assemble(source, "pw", 30, [[0]])).toThrow();
    expect([...qpdf.files.keys()]).toEqual([]);
  });

  it("returns each file in its own buffer", () => {
    const { assembler, source } = setup(2);
    const { files } = assembler.assemble(source, "", 2, [[0], [1]]);
    expect(files[0].buffer).not.toBe(files[1].buffer);
    expect(files[0].byteOffset).toBe(0);
    expect(files[0].byteLength).toBe(files[0].buffer.byteLength);
  });

  it("uses a new token for every call", () => {
    const { qpdf, assembler, source } = setup(2);
    assembler.assemble(source, "", 2, [[0]]);
    assembler.assemble(source, "", 2, [[1]]);
    expect(qpdf.runs[0][0]).toContain("/job-t1-");
    expect(qpdf.runs[1][0]).toContain("/job-t2-");
  });
});
