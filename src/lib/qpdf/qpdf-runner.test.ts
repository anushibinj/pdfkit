import { describe, expect, it, vi } from "vitest";
import {
  QpdfRunner,
  StderrCapture,
  loadQpdf,
  type QpdfFS,
  type QpdfLoaderDeps,
  type QpdfModule,
  type QpdfOptions,
} from "./qpdf-runner";

/** An in-memory file system with the same failure behaviour as Emscripten's. */
function fakeFs(): QpdfFS & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    writeFile: (path, data) => void files.set(path, data),
    readFile: (path) => {
      const data = files.get(path);
      if (!data) throw new Error(`ENOENT ${path}`);
      return data;
    },
    unlink: (path) => {
      if (!files.delete(path)) throw new Error(`ENOENT ${path}`);
    },
    stat: (path) => {
      if (!files.has(path)) throw new Error(`ENOENT ${path}`);
      return {};
    },
  };
}

describe("StderrCapture", () => {
  it("collects lines until reset", () => {
    const capture = new StderrCapture();
    expect(capture.text()).toBe("");
    capture.push("one");
    capture.push("two");
    expect(capture.text()).toBe("one\ntwo");
    capture.reset();
    expect(capture.text()).toBe("");
  });
});

describe("QpdfRunner", () => {
  it("run returns the exit code and only this run's stderr", () => {
    const capture = new StderrCapture();
    const qpdfModule: QpdfModule = {
      FS: fakeFs(),
      callMain: vi.fn((args: string[]) => {
        capture.push(`ran ${args.join(" ")}`);
        return 3;
      }),
    };
    capture.push("left over from loading");
    const runner = new QpdfRunner(qpdfModule, capture);
    expect(runner.run(["--check", "/a.pdf"])).toEqual({
      code: 3,
      stderr: "ran --check /a.pdf",
    });
    expect(qpdfModule.callMain).toHaveBeenCalledWith(["--check", "/a.pdf"]);
  });

  it("writes, reads, checks and removes files", () => {
    const fs = fakeFs();
    const runner = new QpdfRunner({ FS: fs, callMain: () => 0 }, new StderrCapture());
    runner.writeFile("/a.pdf", new Uint8Array([1, 2]));
    expect(runner.exists("/a.pdf")).toBe(true);
    expect(Array.from(runner.readFile("/a.pdf"))).toEqual([1, 2]);
    runner.remove("/a.pdf");
    expect(runner.exists("/a.pdf")).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it("remove ignores missing files and file system errors", () => {
    const fs = fakeFs();
    fs.writeFile("/locked.pdf", new Uint8Array(1));
    fs.unlink = () => {
      throw new Error("EBUSY");
    };
    const runner = new QpdfRunner({ FS: fs, callMain: () => 0 }, new StderrCapture());
    expect(() => runner.remove("/missing.pdf")).not.toThrow();
    expect(() => runner.remove("/locked.pdf")).not.toThrow();
  });
});

describe("loadQpdf", () => {
  /** Dependencies whose glue calls `instantiateWasm` like Emscripten does. */
  function setup(overrides: Partial<QpdfLoaderDeps> = {}) {
    const fs = fakeFs();
    const instance = {} as WebAssembly.Instance;
    const originalWarn = vi.fn();
    const fakeConsole: Pick<Console, "warn" | "log"> = {
      warn: originalWarn,
      log: vi.fn(),
    };
    let options: QpdfOptions | undefined;
    let replacedBeforeImport = false;
    const factory = vi.fn(
      (opts: QpdfOptions) =>
        new Promise<QpdfModule>((resolve) => {
          options = opts;
          opts.instantiateWasm({}, (inst) => {
            expect(inst).toBe(instance);
            resolve({
              FS: fs,
              callMain: () => {
                // The build writes through the console it bound at import.
                fakeConsole.warn("from console.warn");
                opts.printErr("from printErr");
                return 2;
              },
            });
          });
        }),
    );
    const deps: QpdfLoaderDeps = {
      wasmDir: "https://site.test/wasm/",
      importer: vi.fn(async () => {
        replacedBeforeImport = fakeConsole.warn !== originalWarn;
        return { default: factory };
      }),
      console: fakeConsole,
      fetch: vi.fn(async () => new Response(new Uint8Array([0]))),
      wasm: {
        instantiateStreaming: vi.fn(async () => ({
          instance,
          module: {} as WebAssembly.Module,
        })),
        instantiate: vi.fn(async () => ({
          instance,
          module: {} as WebAssembly.Module,
        })) as unknown as typeof WebAssembly.instantiate,
      },
      ...overrides,
    };
    return {
      deps,
      fakeConsole,
      originalWarn,
      getOptions: () => options!,
      replacedBeforeImport: () => replacedBeforeImport,
    };
  }

  it("captures console output before importing, and loads everything from wasmDir", async () => {
    const { deps, originalWarn, getOptions, replacedBeforeImport } = setup();
    const runner = await loadQpdf(deps);
    expect(replacedBeforeImport()).toBe(true);
    expect(deps.importer).toHaveBeenCalledWith("https://site.test/wasm/qpdf.mjs");
    expect(deps.fetch).toHaveBeenCalledWith("https://site.test/wasm/qpdf.wasm");
    expect(getOptions().noInitialRun).toBe(true);
    expect(getOptions().locateFile("qpdf.wasm")).toBe(
      "https://site.test/wasm/qpdf.wasm",
    );
    expect(runner.run(["x"])).toEqual({
      code: 2,
      stderr: "from console.warn\nfrom printErr",
    });
    // stderr went to the capture, not to the original console
    expect(originalWarn).not.toHaveBeenCalled();
  });

  it("falls back to instantiate when streaming compilation is refused", async () => {
    const { deps } = setup();
    vi.mocked(deps.wasm.instantiateStreaming).mockRejectedValueOnce(
      new TypeError("Incorrect response MIME type"),
    );
    await expect(loadQpdf(deps)).resolves.toBeInstanceOf(QpdfRunner);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.wasm.instantiate).toHaveBeenCalledTimes(1);
  });

  it("rejects (instead of hanging) when the binary cannot be loaded", async () => {
    const { deps } = setup();
    vi.mocked(deps.wasm.instantiateStreaming).mockRejectedValueOnce(
      new TypeError("bad mime"),
    );
    vi.mocked(deps.fetch)
      .mockResolvedValueOnce(new Response(new Uint8Array([0])))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(loadQpdf(deps)).rejects.toThrow("Failed to fetch");
  });

  it("propagates a failed import of the glue", async () => {
    const { deps } = setup({
      importer: async () => {
        throw new Error("blocked by CSP");
      },
    });
    await expect(loadQpdf(deps)).rejects.toThrow("blocked by CSP");
  });
});
