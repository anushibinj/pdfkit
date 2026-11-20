import { describe, expect, it, vi } from "vitest";
import type { CapturableConsole } from "./console-capture";
import { loadQpdf } from "./load-qpdf";
import type { QpdfGlue, QpdfModule, QpdfOptions } from "./qpdf-module";

const fakeInstance = {} as WebAssembly.Instance;

/**
 * A glue whose factory behaves like Emscripten: it binds console.warn when
 * it runs, asks `instantiateWasm` for the binary and resolves once `done`
 * was called.
 */
function fakeGlue(target: CapturableConsole) {
  const program: QpdfModule = {
    FS: {
      writeFile: () => {},
      readFile: () => new Uint8Array(),
      unlink: () => {},
      stat: () => ({}),
    },
    callMain: vi.fn(() => {
      boundWarn("qpdf: /job-1-in.pdf: invalid password");
      return 2;
    }),
  };
  let boundWarn: (...args: unknown[]) => void = () => {};
  const factory = vi.fn(
    (options: QpdfOptions) =>
      new Promise<QpdfModule>((resolve) => {
        boundWarn = target.warn.bind(target);
        options.instantiateWasm({}, () => resolve(program));
      }),
  );
  return { glue: { default: factory } satisfies QpdfGlue, factory, program };
}

describe("loadQpdf", () => {
  it("captures output bound by the factory and loads everything from wasmDir", async () => {
    const target: CapturableConsole = { log: () => {}, warn: () => {} };
    const { glue, factory } = fakeGlue(target);
    const importer = vi.fn(async () => glue);
    const instantiate = vi.fn(async () => fakeInstance);

    const runner = await loadQpdf("https://site.test/wasm/", {
      importer,
      instantiate,
      console: target,
    });

    expect(importer).toHaveBeenCalledWith("https://site.test/wasm/qpdf.mjs");
    const options = factory.mock.calls[0][0];
    expect(options.noInitialRun).toBe(true);
    expect(options.locateFile("qpdf.wasm")).toBe(
      "https://site.test/wasm/qpdf.wasm",
    );
    expect(instantiate).toHaveBeenCalledWith({});
    // console.warn was replaced before the factory bound it
    expect(runner.run(["/x.pdf"])).toEqual({
      code: 2,
      stdout: "",
      stderr: "qpdf: /job-1-in.pdf: invalid password",
    });
  });

  it("rejects instead of hanging when the binary cannot be instantiated", async () => {
    const target: CapturableConsole = { log: () => {}, warn: () => {} };
    const { glue } = fakeGlue(target);
    await expect(
      loadQpdf("/wasm/", {
        importer: async () => glue,
        instantiate: async () => {
          throw new Error("CompileError");
        },
        console: target,
      }),
    ).rejects.toThrow("CompileError");
  });

  it("propagates a failed import of the glue", async () => {
    await expect(
      loadQpdf("/wasm/", {
        importer: async () => {
          throw new TypeError("Failed to fetch dynamically imported module");
        },
        instantiate: async () => fakeInstance,
        console: { log: () => {}, warn: () => {} },
      }),
    ).rejects.toThrow("Failed to fetch");
  });
});
