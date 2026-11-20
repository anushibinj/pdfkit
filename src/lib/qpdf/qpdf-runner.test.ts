import { describe, expect, it, vi } from "vitest";
import { ConsoleCapture } from "./console-capture";
import type { QpdfModule } from "./qpdf-module";
import { QpdfJob, QpdfRunner } from "./qpdf-runner";

/** A qpdf module with a Map as its file system. */
function fakeModule(callMain: QpdfModule["callMain"] = () => 0) {
  const files = new Map<string, Uint8Array>();
  const program: QpdfModule = {
    FS: {
      writeFile: (path, data) => void files.set(path, data),
      readFile: (path) => {
        const data = files.get(path);
        if (!data) throw new Error(`ENOENT ${path}`);
        return data;
      },
      unlink: (path) => void files.delete(path),
      stat: (path) => {
        if (!files.has(path)) throw new Error(`ENOENT ${path}`);
        return {};
      },
    },
    callMain: vi.fn(callMain),
  };
  return { module: program, files };
}

describe("QpdfJob", () => {
  it("prefixes names and remembers each path once", () => {
    const job = new QpdfJob("/job-7");
    expect(job.path("in.pdf")).toBe("/job-7-in.pdf");
    job.path("in.pdf");
    job.path("out.pdf");
    expect(job.paths()).toEqual(["/job-7-in.pdf", "/job-7-out.pdf"]);
  });
});

describe("QpdfRunner", () => {
  it("run returns the exit code and only this run's output", () => {
    const capture = new ConsoleCapture();
    capture.writeErr("left over from an earlier run");
    const { module } = fakeModule(() => {
      capture.writeOut("out");
      capture.writeErr("err");
      return 3;
    });
    const runner = new QpdfRunner(module, capture);
    expect(runner.run(["--check", "/a.pdf"])).toEqual({
      code: 3,
      stdout: "out",
      stderr: "err",
    });
    expect(module.callMain).toHaveBeenCalledWith(["--check", "/a.pdf"]);
  });

  it("writes, reads, checks and removes files", () => {
    const { module, files } = fakeModule();
    const runner = new QpdfRunner(module, new ConsoleCapture());
    runner.writeFile("/a", new Uint8Array([1]));
    expect(runner.exists("/a")).toBe(true);
    expect(Array.from(runner.readFile("/a"))).toEqual([1]);
    runner.remove("/a");
    runner.remove("/a"); // missing: no error
    expect(runner.exists("/a")).toBe(false);
    expect(files.size).toBe(0);
  });

  it("remove never throws, even when the file system does", () => {
    const { module } = fakeModule();
    module.FS.stat = () => ({});
    module.FS.unlink = () => {
      throw new Error("EBUSY");
    };
    const runner = new QpdfRunner(module, new ConsoleCapture());
    expect(() => runner.remove("/a")).not.toThrow();
  });

  it("withJob gives each job unique names and deletes its files afterwards", () => {
    const { module, files } = fakeModule();
    const runner = new QpdfRunner(module, new ConsoleCapture());
    const first = runner.withJob((job) => {
      runner.writeFile(job.path("in.pdf"), new Uint8Array([1]));
      runner.writeFile(job.path("out.pdf"), new Uint8Array([2]));
      return job.path("in.pdf");
    });
    const second = runner.withJob((job) => job.path("in.pdf"));
    expect(first).not.toBe(second);
    expect(files.size).toBe(0);
  });

  it("withJob deletes the files when the work throws", () => {
    const { module, files } = fakeModule();
    const runner = new QpdfRunner(module, new ConsoleCapture());
    expect(() =>
      runner.withJob((job) => {
        runner.writeFile(job.path("in.pdf"), new Uint8Array([1]));
        throw new RangeError("out of memory");
      }),
    ).toThrow(RangeError);
    expect(files.size).toBe(0);
  });
});
