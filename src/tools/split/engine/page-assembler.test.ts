import { describe, expect, it, vi } from "vitest";
import type { QpdfRun } from "@/lib/qpdf/qpdf-runner";
import {
  AssemblyError,
  PageAssembler,
  WrongPasswordError,
  type QpdfCommands,
} from "./page-assembler";

/** A "PDF" for the fake: its password and the labels of its pages. */
interface FakePdf {
  password: string;
  pages: string[];
}

const encode = (pdf: FakePdf) => new TextEncoder().encode(JSON.stringify(pdf));
const decode = (bytes: Uint8Array): FakePdf =>
  JSON.parse(new TextDecoder().decode(bytes));

/**
 * A fake qpdf that understands exactly the command the assembler sends:
 * `[--password=…] <in> --pages . <ranges> -- <out>`. It checks the
 * password, resolves 1-based ranges like qpdf, and keeps the password on
 * the output (as qpdf keeps the encryption).
 */
class FakeQpdf implements QpdfCommands {
  readonly files = new Map<string, Uint8Array>();
  readonly runs: string[][] = [];
  /** Set to make the next run exit with this result instead. */
  nextResult: QpdfRun | null = null;
  warnOn: string | null = null;

  run(args: string[]): QpdfRun {
    this.runs.push(args);
    if (this.nextResult) {
      const result = this.nextResult;
      this.nextResult = null;
      return result;
    }
    // Parse a copy: `runs` keeps the arguments exactly as they were sent.
    const rest = [...args];
    const password = rest[0].startsWith("--password=")
      ? rest.shift()!.slice("--password=".length)
      : "";
    const [input, pagesFlag, dot, ranges, dashes, output] = rest;
    expect([pagesFlag, dot, dashes]).toEqual(["--pages", ".", "--"]);
    const pdf = decode(this.files.get(input)!);
    if (pdf.password !== password) {
      return { code: 2, stderr: `qpdf: ${input}: invalid password` };
    }
    const pages: string[] = [];
    for (const item of ranges.split(",")) {
      const [a, b = a] = item.split("-").map(Number);
      expect(a).toBeLessThanOrEqual(b);
      for (let p = a; p <= b; p++) {
        if (p < 1 || p > pdf.pages.length) {
          return { code: 2, stderr: `qpdf: page range ${item} is out of range` };
        }
        pages.push(pdf.pages[p - 1]);
      }
    }
    this.files.set(output, encode({ password: pdf.password, pages }));
    if (this.warnOn && pages.includes(this.warnOn)) {
      return { code: 3, stderr: `WARNING: ${input}: repaired page ${this.warnOn}` };
    }
    return { code: 0, stderr: "" };
  }

  writeFile(path: string, data: Uint8Array): void {
    this.files.set(path, data);
  }
  readFile(path: string): Uint8Array {
    return this.files.get(path)!.slice();
  }
  exists(path: string): boolean {
    return this.files.has(path);
  }
  remove(path: string): void {
    this.files.delete(path);
  }
}

const labels = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function setup(pages = 5, password = "") {
  const qpdf = new FakeQpdf();
  const assembler = new PageAssembler(qpdf, () => 0.5);
  const source = encode({ password, pages: labels(pages) });
  return { qpdf, assembler, source };
}

describe("PageAssembler", () => {
  it("makes each output with qpdf --pages and returns them in plan order", () => {
    const { qpdf, assembler, source } = setup(5);
    const result = assembler.assemble(source, "", 5, [[0, 1, 2], [4], [3]]);
    expect(result.files.map((f) => decode(f).pages)).toEqual([
      ["p1", "p2", "p3"],
      ["p5"],
      ["p4"],
    ]);
    expect(result.warnings).toEqual([]);
    expect(qpdf.runs[0]).toEqual([
      "/job-1-i-in.pdf",
      "--pages",
      ".",
      "1-3",
      "--",
      "/job-1-i-out.pdf",
    ]);
  });

  it("writes non-consecutive pages as a comma list", () => {
    const { qpdf, assembler, source } = setup(5);
    assembler.assemble(source, "", 5, [[0, 2, 3]]);
    expect(qpdf.runs[0][3]).toBe("1,3-4");
  });

  it("passes the password and the outputs keep it", () => {
    const { qpdf, assembler, source } = setup(3, "hunter2");
    const result = assembler.assemble(source, "hunter2", 3, [[1]]);
    expect(qpdf.runs[0][0]).toBe("--password=hunter2");
    expect(decode(result.files[0])).toEqual({ password: "hunter2", pages: ["p2"] });
  });

  it("goes through parts for many outputs and gets the same files", () => {
    const { qpdf, assembler, source } = setup(100);
    const outputs = Array.from({ length: 100 }, (_, i) => [i]);
    const result = assembler.assemble(source, "", 100, outputs);
    expect(result.files.map((f) => decode(f).pages)).toEqual(
      labels(100).map((l) => [l]),
    );
    // 10 parts + 100 outputs, instead of 100 runs over the whole file
    const fromSource = qpdf.runs.filter((r) => r[0].endsWith("-in.pdf"));
    expect(fromSource).toHaveLength(10);
    expect(qpdf.runs).toHaveLength(110);
  });

  it("keeps the password through parts", () => {
    const { assembler, source } = setup(20, "pw");
    const outputs = Array.from({ length: 20 }, (_, i) => [i]);
    const result = assembler.assemble(source, "pw", 20, outputs);
    expect(result.files.every((f) => decode(f).password === "pw")).toBe(true);
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
    const { qpdf, assembler, source } = setup(3);
    qpdf.warnOn = "p2";
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
    const { qpdf, assembler, source } = setup(3);
    qpdf.nextResult = {
      code: 2,
      stderr: "qpdf: /job-1-i-in.pdf: can't find startxref",
    };
    expect(() => assembler.assemble(source, "", 3, [[0]])).toThrow(
      new AssemblyError("This does not look like a valid PDF file, or it is damaged."),
    );
  });

  it("treats a missing output as a failure even with exit code 0", () => {
    const { qpdf, assembler, source } = setup(3);
    qpdf.nextResult = { code: 0, stderr: "" };
    expect(() => assembler.assemble(source, "", 3, [[0]])).toThrow(AssemblyError);
  });

  it("deletes every temporary file, after success and after failure", () => {
    const { qpdf, assembler, source } = setup(30);
    assembler.assemble(source, "", 30, Array.from({ length: 30 }, (_, i) => [i]));
    expect(qpdf.files.size).toBe(0);
    qpdf.nextResult = { code: 2, stderr: "boom" };
    expect(() => assembler.assemble(source, "", 30, [[0]])).toThrow();
    expect(qpdf.files.size).toBe(0);
  });

  it("uses a new job name for every call", () => {
    const { qpdf, assembler, source } = setup(2);
    assembler.assemble(source, "", 2, [[0]]);
    assembler.assemble(source, "", 2, [[1]]);
    expect(qpdf.runs[0][0]).toMatch(/^\/job-1-/);
    expect(qpdf.runs[1][0]).toMatch(/^\/job-2-/);
  });
});
