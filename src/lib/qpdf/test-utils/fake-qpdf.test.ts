import { describe, expect, it } from "vitest";
import { FakeQpdfRunner } from "./fake-qpdf";

describe("FakeQpdfRunner", () => {
  it("defaults to a silent successful run", () => {
    expect(new FakeQpdfRunner().run(["x"])).toEqual({ code: 0, stderr: "" });
  });

  it("records runs and snapshots job JSON while it exists", () => {
    const runner = new FakeQpdfRunner();
    runner.writeFile("/j.json", new TextEncoder().encode('{"inputFile":"/a"}'));
    runner.run(["--job-json-file=/j.json"]);
    runner.run(["--check", "/a"]);
    expect(runner.runs).toEqual([
      ["--job-json-file=/j.json"],
      ["--check", "/a"],
    ]);
    expect(runner.jobs).toEqual([{ inputFile: "/a" }]);
  });

  it("gives the script access to the files", () => {
    const runner = new FakeQpdfRunner((_args, files) => {
      files.set("/out.pdf", new Uint8Array([9]));
      return { code: 0, stderr: "" };
    });
    runner.run([]);
    expect(Array.from(runner.readFile("/out.pdf"))).toEqual([9]);
  });

  it("copies written data, reads, checks and removes files", () => {
    const runner = new FakeQpdfRunner();
    const data = new Uint8Array([1]);
    runner.writeFile("/a", data);
    data[0] = 2;
    expect(Array.from(runner.readFile("/a"))).toEqual([1]);
    expect(runner.exists("/a")).toBe(true);
    runner.remove("/a");
    runner.remove("/a");
    expect(runner.exists("/a")).toBe(false);
    expect(() => runner.readFile("/a")).toThrow(/ENOENT/);
  });
});
