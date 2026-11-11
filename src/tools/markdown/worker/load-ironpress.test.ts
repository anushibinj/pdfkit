import { describe, expect, it, vi } from "vitest";
import { loadIronpress, type IronpressGlue } from "./load-ironpress";

describe("loadIronpress", () => {
  it("imports the glue and initialises the binary from the given directory", async () => {
    class HtmlConverter {}
    const init = vi.fn(async () => ({}));
    const glue = { default: init, HtmlConverter } as unknown as IronpressGlue;
    const importer = vi.fn(async () => glue);

    const api = await loadIronpress("https://site.test/wasm/", importer);

    expect(importer).toHaveBeenCalledWith(
      "https://site.test/wasm/ironpress.js",
    );
    expect(init).toHaveBeenCalledWith({
      module_or_path: "https://site.test/wasm/ironpress_bg.wasm",
    });
    expect(api.HtmlConverter).toBe(HtmlConverter);
  });

  it("propagates initialisation failures", async () => {
    const glue = {
      default: async () => {
        throw new Error("CompileError");
      },
    };
    await expect(loadIronpress("/wasm/", async () => glue)).rejects.toThrow(
      "CompileError",
    );
  });
});
