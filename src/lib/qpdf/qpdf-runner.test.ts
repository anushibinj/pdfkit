import { describe, expect, it, vi } from "vitest";
import {
  EmscriptenQpdfRunner,
  StderrLog,
  type QpdfModule,
} from "./qpdf-runner";

/** An in-memory stand-in for Emscripten's FS and `callMain`. */
function fakeModule(main: (args: string[], log: StderrLog) => number) {
  const files = new Map<string, Uint8Array>();
  const log = new StderrLog();
  const qpdfModule: QpdfModule = {
    FS: {
      writeFile: vi.fn((p: string, d: Uint8Array) => void files.set(p, d)),
      readFile: vi.fn((p: string) => {
        const f = files.get(p);
        if (!f) throw new Error(`ENOENT ${p}`);
        return f;
      }),
      unlink: vi.fn((p: string) => {
        if (!files.delete(p)) throw new Error(`ENOENT ${p}`);
      }),
      stat: vi.fn((p: string) => {
        if (!files.has(p)) throw new Error(`ENOENT ${p}`);
        return {};
      }),
    },
    callMain: vi.fn((args: string[]) => main(args, log)),
  };
  return {
    module: qpdfModule,
    log,
    files,
    runner: new EmscriptenQpdfRunner(qpdfModule, log),
  };
}

describe("StderrLog", () => {
  it("joins appended lines and starts empty", () => {
    const log = new StderrLog();
    expect(log.text()).toBe("");
    log.append("a");
    log.append("b");
    expect(log.text()).toBe("a\nb");
  });

  it("clear forgets earlier lines", () => {
    const log = new StderrLog();
    log.append("old");
    log.clear();
    log.append("new");
    expect(log.text()).toBe("new");
  });
});

describe("EmscriptenQpdfRunner", () => {
  it("run returns the exit code and only this run's stderr", () => {
    let call = 0;
    const { runner, module } = fakeModule((_args, log) => {
      log.append(`run ${++call}`);
      return call === 1 ? 2 : 0;
    });
    expect(runner.run(["--version"])).toEqual({ code: 2, stderr: "run 1" });
    expect(runner.run(["--check", "/x.pdf"])).toEqual({
      code: 0,
      stderr: "run 2",
    });
    expect(module.callMain).toHaveBeenLastCalledWith(["--check", "/x.pdf"]);
  });

  it("run passes a copy of the arguments", () => {
    const { runner, module } = fakeModule(() => 0);
    const args = Object.freeze(["--version"]);
    runner.run(args);
    const passed = vi.mocked(module.callMain).mock.calls[0][0];
    expect(passed).toEqual(["--version"]);
    expect(passed).not.toBe(args);
  });

  it("writes, reads and checks files", () => {
    const { runner } = fakeModule(() => 0);
    expect(runner.exists("/a.pdf")).toBe(false);
    runner.writeFile("/a.pdf", new Uint8Array([1, 2]));
    expect(runner.exists("/a.pdf")).toBe(true);
    expect(Array.from(runner.readFile("/a.pdf"))).toEqual([1, 2]);
  });

  it("readFile throws for a missing file", () => {
    const { runner } = fakeModule(() => 0);
    expect(() => runner.readFile("/missing.pdf")).toThrow(/ENOENT/);
  });

  it("remove deletes a file and ignores missing ones", () => {
    const { runner, files } = fakeModule(() => 0);
    runner.writeFile("/a.pdf", new Uint8Array([1]));
    runner.remove("/a.pdf");
    expect(files.has("/a.pdf")).toBe(false);
    expect(() => runner.remove("/a.pdf")).not.toThrow();
  });

  it("remove never throws, even when unlink fails", () => {
    const { runner, module } = fakeModule(() => 0);
    runner.writeFile("/a.pdf", new Uint8Array([1]));
    vi.mocked(module.FS.unlink).mockImplementation(() => {
      throw new Error("EBUSY");
    });
    expect(() => runner.remove("/a.pdf")).not.toThrow();
  });
});
