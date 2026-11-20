import { describe, expect, it, vi } from "vitest";
import type { QpdfFS, QpdfModule } from "./qpdf-module";
import { QpdfOutput, type ConsoleLike } from "./qpdf-output";
import { QpdfJob, QpdfRunner } from "./qpdf-runner";

/** An in-memory stand-in for Emscripten's file system. */
function fakeFs() {
  const files = new Map<string, Uint8Array>();
  const fs: QpdfFS = {
    writeFile: vi.fn((path: string, data: Uint8Array) => {
      files.set(path, data);
    }),
    readFile: vi.fn((path: string) => {
      const data = files.get(path);
      if (!data) throw new Error(`ENOENT ${path}`);
      return data;
    }),
    unlink: vi.fn((path: string) => {
      files.delete(path);
    }),
    stat: vi.fn((path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT ${path}`);
      return {};
    }),
  };
  return { fs, files };
}

describe("QpdfJob", () => {
  it("prefixes every name with the job's prefix", () => {
    const { fs } = fakeFs();
    const job = new QpdfJob(fs, "/job-4");
    expect(job.path("in-0.pdf")).toBe("/job-4-in-0.pdf");
  });

  it("rejects names that could leave the job's prefix", () => {
    const job = new QpdfJob(fakeFs().fs, "/job-1");
    expect(() => job.path("../etc/passwd")).toThrow(/Invalid job file name/);
    expect(() => job.path("a b.pdf")).toThrow(/Invalid job file name/);
    expect(() => job.path("")).toThrow(/Invalid job file name/);
  });

  it("writes, reads and checks files", () => {
    const { fs } = fakeFs();
    const job = new QpdfJob(fs, "/job-1");
    const bytes = new Uint8Array([1, 2]);
    expect(job.exists("in.pdf")).toBe(false);
    expect(job.write("in.pdf", bytes)).toBe("/job-1-in.pdf");
    expect(job.exists("in.pdf")).toBe(true);
    expect(job.read("in.pdf")).toBe(bytes);
  });

  it("deletes written files and files qpdf created on dispose", () => {
    const { fs, files } = fakeFs();
    const job = new QpdfJob(fs, "/job-1");
    job.write("in.pdf", new Uint8Array([1]));
    const out = job.path("out.pdf");
    files.set(out, new Uint8Array([2])); // as if qpdf wrote it
    job.path("never-created.pdf");
    files.set("/other-file.pdf", new Uint8Array([3]));
    job.dispose();
    expect([...files.keys()]).toEqual(["/other-file.pdf"]);
    expect(fs.unlink).toHaveBeenCalledTimes(2); // nothing for the missing one
  });

  it("keeps deleting after one unlink fails", () => {
    const { fs, files } = fakeFs();
    const job = new QpdfJob(fs, "/job-1");
    job.write("a.pdf", new Uint8Array([1]));
    job.write("b.pdf", new Uint8Array([2]));
    vi.mocked(fs.unlink).mockImplementationOnce(() => {
      throw new Error("EBUSY");
    });
    expect(() => job.dispose()).not.toThrow();
    expect([...files.keys()]).toEqual(["/job-1-a.pdf"]);
  });
});

describe("QpdfRunner", () => {
  /** A module whose qpdf prints through the console the output is attached to. */
  function setup(main: (args: string[], console: ConsoleLike) => number) {
    const { fs, files } = fakeFs();
    const target: ConsoleLike = { log: () => {}, warn: () => {} };
    const output = new QpdfOutput();
    output.attachTo(target);
    const qpdf: QpdfModule = {
      FS: fs,
      callMain: vi.fn((args: string[]) => main(args, target)),
    };
    return { runner: new QpdfRunner(qpdf, output), qpdf, files };
  }

  it("returns the exit code and only this command's output", () => {
    const { runner } = setup((args, c) => {
      c.log(`out ${args[0]}`);
      c.warn(`err ${args[0]}`);
      return args[0] === "fail" ? 2 : 0;
    });
    expect(runner.run(["ok"])).toEqual({
      code: 0,
      stdout: "out ok",
      stderr: "err ok",
    });
    expect(runner.run(["fail"])).toEqual({
      code: 2,
      stdout: "out fail",
      stderr: "err fail",
    });
  });

  it("passes a copy of the arguments", () => {
    const { runner, qpdf } = setup(() => 0);
    const args = ["--show-npages", "/x.pdf"] as const;
    runner.run(args);
    const passed = vi.mocked(qpdf.callMain).mock.calls[0][0];
    expect(passed).toEqual(args);
    expect(passed).not.toBe(args);
  });

  it("gives every job a new prefix and cleans up after it", () => {
    const { runner, files } = setup(() => 0);
    const first = runner.withJob((job) =>
      job.write("in.pdf", new Uint8Array([1])),
    );
    const second = runner.withJob((job) => job.path("in.pdf"));
    expect(first).toBe("/job-1-in.pdf");
    expect(second).toBe("/job-2-in.pdf");
    expect(files.size).toBe(0);
  });

  it("cleans up when the job throws, and rethrows", () => {
    const { runner, files } = setup(() => 0);
    expect(() =>
      runner.withJob((job) => {
        job.write("in.pdf", new Uint8Array([1]));
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(files.size).toBe(0);
  });
});
