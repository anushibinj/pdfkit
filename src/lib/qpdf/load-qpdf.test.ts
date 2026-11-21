import { describe, expect, it, vi } from "vitest";
import {
  instantiateWasmFromUrl,
  loadQpdf,
  type QpdfLoadOptions,
  type WasmCompiler,
} from "./load-qpdf";
import { StderrLog, type QpdfModule } from "./qpdf-runner";

const instance = {} as WebAssembly.Instance;

describe("instantiateWasmFromUrl", () => {
  it("uses streaming compilation when it works", async () => {
    const response = new Response("x");
    const fetchFn = vi.fn(async () => response);
    const wasm: WasmCompiler = {
      instantiateStreaming: vi.fn(async () => ({
        instance,
        module: {} as WebAssembly.Module,
      })),
      instantiate: vi.fn(),
    } as unknown as WasmCompiler;
    const imports = { env: {} };
    await expect(
      instantiateWasmFromUrl("/wasm/qpdf.wasm", imports, fetchFn, wasm),
    ).resolves.toBe(instance);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(wasm.instantiateStreaming).toHaveBeenCalledWith(
      expect.any(Promise),
      imports,
    );
    expect(wasm.instantiate).not.toHaveBeenCalled();
  });

  it("falls back to buffering the bytes when streaming fails", async () => {
    const fetchFn = vi.fn(
      async () => new Response(new Uint8Array([0, 97, 115, 109])),
    );
    const wasm = {
      instantiateStreaming: vi.fn(async () => {
        throw new TypeError("Incorrect response MIME type");
      }),
      instantiate: vi.fn(async () => ({ instance, module: {} })),
    } as unknown as WasmCompiler;
    await expect(
      instantiateWasmFromUrl("/wasm/qpdf.wasm", {}, fetchFn, wasm),
    ).resolves.toBe(instance);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const bytes = vi.mocked(wasm.instantiate).mock
      .calls[0][0] as unknown as ArrayBuffer;
    expect(Array.from(new Uint8Array(bytes))).toEqual([0, 97, 115, 109]);
  });

  it("rejects when both attempts fail", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const wasm = {
      instantiateStreaming: vi.fn(async (p: Promise<Response>) => p),
      instantiate: vi.fn(),
    } as unknown as WasmCompiler;
    await expect(
      instantiateWasmFromUrl("/wasm/qpdf.wasm", {}, fetchFn, wasm),
    ).rejects.toThrow("Failed to fetch");
  });
});

/**
 * Builds a fake glue module whose factory behaves like Emscripten's: it calls
 * `instantiateWasm`, waits for `done`, binds `console.warn` and `console.log`
 * itself and writes stderr and stdout through them when `callMain` runs.
 */
interface FakeFactoryOptions {
  noInitialRun: boolean;
  print: (line: string) => void;
  locateFile: (file: string) => string;
  instantiateWasm: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance) => void,
  ) => unknown;
}

function fakeGlue() {
  const factory = vi.fn(async (opts: FakeFactoryOptions) => {
    const host = (globalThis as { fakeConsole?: Pick<Console, "warn" | "log"> })
      .fakeConsole!;
    const warn = host.warn.bind(host);
    const log = host.log.bind(host);
    await new Promise<void>((resolve) =>
      opts.instantiateWasm({}, () => resolve()),
    );
    const qpdfModule: QpdfModule = {
      FS: {
        writeFile() {},
        readFile: () => new Uint8Array(),
        unlink() {},
        stat: () => ({}),
      },
      callMain: (args) => {
        warn("stderr for", args.join(" "));
        log("stdout for", args.join(" "));
        return 3;
      },
    };
    return qpdfModule;
  });
  return { factory, glue: { default: factory } };
}

function options(overrides: Partial<QpdfLoadOptions> = {}) {
  const fakeConsole = { warn: vi.fn(), log: vi.fn() };
  (globalThis as { fakeConsole?: unknown }).fakeConsole = fakeConsole;
  const { glue, factory } = fakeGlue();
  const opts: QpdfLoadOptions = {
    wasmDir: "https://site.test/wasm/",
    importModule: vi.fn(async () => glue),
    instantiate: vi.fn(async () => instance),
    console: fakeConsole,
    stderr: new StderrLog(),
    ...overrides,
  };
  return { opts, factory, fakeConsole };
}

describe("loadQpdf", () => {
  it("imports the glue and instantiates the binary from the given directory", async () => {
    const { opts, factory } = options();
    await loadQpdf(opts);
    expect(opts.importModule).toHaveBeenCalledWith(
      "https://site.test/wasm/qpdf.mjs",
    );
    expect(opts.instantiate).toHaveBeenCalledWith(
      "https://site.test/wasm/qpdf.wasm",
      {},
    );
    const factoryOptions = factory.mock.calls[0][0];
    expect(factoryOptions).toMatchObject({ noInitialRun: true });
    expect(factoryOptions.locateFile("x.data")).toBe(
      "https://site.test/wasm/x.data",
    );
  });

  it("captures stderr written through console.warn and silences console.log", async () => {
    const { opts, fakeConsole } = options();
    const runner = await loadQpdf(opts);
    expect(runner.run(["--check", "/a.pdf"])).toEqual({
      code: 3,
      stderr: "stderr for --check /a.pdf",
    });
    expect(() => fakeConsole.log("ignored")).not.toThrow();
  });

  it("captures stdout written through console.log when given a stdout log", async () => {
    const stdout = new StderrLog();
    const { opts } = options({ stdout });
    const runner = await loadQpdf(opts);
    expect(runner.run(["--show-npages", "/a.pdf"])).toEqual({
      code: 3,
      stderr: "stderr for --show-npages /a.pdf",
      stdout: "stdout for --show-npages /a.pdf",
    });
  });

  it("wires print to the stdout log, for builds that honour it", async () => {
    const stdout = new StderrLog();
    const { opts, factory } = options({ stdout });
    await loadQpdf(opts);
    factory.mock.calls[0][0].print("7");
    expect(stdout.text()).toBe("7");
  });

  it("keeps capturing into the shared log after a reload", async () => {
    const stderr = new StderrLog();
    const first = options({ stderr });
    await loadQpdf(first.opts);
    // A second load in the same worker (after a crash) with the same log.
    const second = await loadQpdf({ ...first.opts, stderr });
    expect(second.run(["x"]).stderr).toBe("stderr for x");
  });

  it("rejects instead of hanging when instantiation fails", async () => {
    const { opts } = options({
      instantiate: vi.fn(async () => {
        throw new Error("CompileError: bad magic");
      }),
    });
    await expect(loadQpdf(opts)).rejects.toThrow("bad magic");
  });

  it("rejects when the glue cannot be imported", async () => {
    const { opts } = options({
      importModule: vi.fn(async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      }),
    });
    await expect(loadQpdf(opts)).rejects.toThrow("dynamically imported");
  });
});
