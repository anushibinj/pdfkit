// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createStreamingInstantiator,
  instantiateQpdf,
  loadQpdf,
  type WasmInstantiator,
} from "./load-qpdf";
import type {
  QpdfFactory,
  QpdfFactoryOptions,
  QpdfModule,
} from "./qpdf-module";
import { QpdfOutput, type ConsoleLike } from "./qpdf-output";
import { QpdfRunner } from "./qpdf-runner";

/** The smallest valid WebAssembly module: magic number and version only. */
const EMPTY_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

const fakeModule = (): QpdfModule => ({
  FS: {
    writeFile: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
  },
  callMain: vi.fn(() => 0),
});

/**
 * A factory that behaves like Emscripten's: it hands instantiation to
 * `instantiateWasm` and resolves only once `done` is called.
 */
function emscriptenLikeFactory(qpdfModule: QpdfModule) {
  const seen: QpdfFactoryOptions[] = [];
  const factory: QpdfFactory = (options) => {
    seen.push(options);
    return new Promise((resolve) => {
      options.instantiateWasm({ env: {} }, () => resolve(qpdfModule));
    });
  };
  return { factory, seen };
}

describe("createStreamingInstantiator", () => {
  it("streams a binary served as application/wasm", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(EMPTY_WASM, {
          headers: { "Content-Type": "application/wasm" },
        }),
    );
    const instance = await createStreamingInstantiator(fetchFn)(
      "/wasm/x.wasm",
      {},
    );
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/wasm/x.wasm");
  });

  it("falls back to a plain download when streaming is refused", async () => {
    // Served with the wrong type, which instantiateStreaming rejects.
    const fetchFn = vi.fn(
      async () =>
        new Response(EMPTY_WASM, {
          headers: { "Content-Type": "application/octet-stream" },
        }),
    );
    const instance = await createStreamingInstantiator(fetchFn)(
      "/wasm/x.wasm",
      {},
    );
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects when the fallback fails too", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      createStreamingInstantiator(fetchFn)("/wasm/x.wasm", {}),
    ).rejects.toThrow("Failed to fetch");
  });
});

describe("instantiateQpdf", () => {
  it("instantiates qpdf.wasm from the given directory", async () => {
    const qpdfModule = fakeModule();
    const { factory, seen } = emscriptenLikeFactory(qpdfModule);
    const fakeInstance = {} as WebAssembly.Instance;
    const instantiate = vi.fn<WasmInstantiator>(async () => fakeInstance);

    await expect(
      instantiateQpdf(factory, "https://site.test/wasm/", instantiate),
    ).resolves.toBe(qpdfModule);
    expect(instantiate).toHaveBeenCalledWith(
      "https://site.test/wasm/qpdf.wasm",
      { env: {} },
    );
    expect(seen[0].noInitialRun).toBe(true);
    expect(seen[0].locateFile("qpdf.wasm")).toBe(
      "https://site.test/wasm/qpdf.wasm",
    );
  });

  it("rejects instead of hanging when the binary cannot be loaded", async () => {
    // done() is never called, so the factory's own promise never settles.
    const { factory } = emscriptenLikeFactory(fakeModule());
    const instantiate: WasmInstantiator = async () => {
      throw new Error("CompileError");
    };
    await expect(
      instantiateQpdf(factory, "/wasm/", instantiate),
    ).rejects.toThrow("CompileError");
  });

  it("returns {} synchronously from instantiateWasm, as Emscripten requires", () => {
    let returned: unknown;
    const factory: QpdfFactory = (options) => {
      returned = options.instantiateWasm({}, () => {});
      return new Promise(() => {});
    };
    void instantiateQpdf(factory, "/wasm/", () => new Promise(() => {}));
    expect(returned).toEqual({});
  });
});

describe("loadQpdf", () => {
  it("attaches the output to the console before the factory runs", async () => {
    const target: ConsoleLike = { log: vi.fn(), warn: vi.fn() };
    const originalLog = target.log;
    const output = new QpdfOutput();
    const qpdfModule = fakeModule();
    let logAtFactoryTime: unknown;
    const factory: QpdfFactory = (options) => {
      // What the real glue does: bind the console as it is right now.
      logAtFactoryTime = target.log;
      const boundWarn = target.warn.bind(target);
      return new Promise((resolve) =>
        options.instantiateWasm({}, () => {
          boundWarn("qpdf: started");
          resolve(qpdfModule);
        }),
      );
    };
    const importer = vi.fn(async () => ({ default: factory }));

    const runner = await loadQpdf({
      wasmDir: "https://site.test/wasm/",
      importer,
      instantiate: async () => ({}) as WebAssembly.Instance,
      output,
      console: target,
    });

    expect(importer).toHaveBeenCalledWith("https://site.test/wasm/qpdf.mjs");
    expect(runner).toBeInstanceOf(QpdfRunner);
    expect(logAtFactoryTime).not.toBe(originalLog);
    // What the glue printed through its bound copy reached our output.
    expect(output.stderr()).toBe("qpdf: started");
  });

  it("propagates a failed import", async () => {
    await expect(
      loadQpdf({
        wasmDir: "/wasm/",
        importer: async () => {
          throw new Error("Failed to fetch dynamically imported module");
        },
        instantiate: async () => ({}) as WebAssembly.Instance,
        output: new QpdfOutput(),
        console: { log: () => {}, warn: () => {} },
      }),
    ).rejects.toThrow("Failed to fetch dynamically imported module");
  });
});
