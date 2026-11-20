// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { instantiateFromUrl } from "./instantiate-wasm";

/** The smallest valid WebAssembly module: the magic number and version 1. */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

function wasmResponse(contentType: string): Response {
  return new Response(EMPTY_MODULE, {
    headers: { "Content-Type": contentType },
  });
}

describe("instantiateFromUrl", () => {
  it("compiles while streaming when the server sends application/wasm", async () => {
    const fetcher = vi.fn(async () => wasmResponse("application/wasm"));
    const instance = await instantiateFromUrl("/wasm/x.wasm", fetcher)({});
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/wasm/x.wasm");
  });

  it("falls back to plain bytes when streaming is refused (wrong MIME type)", async () => {
    const fetcher = vi.fn(async () => wasmResponse("application/octet-stream"));
    const instance = await instantiateFromUrl("/wasm/x.wasm", fetcher)({});
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects when the download fails both times", async () => {
    const fetcher = vi.fn(async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      instantiateFromUrl("/wasm/x.wasm", fetcher)({}),
    ).rejects.toThrow("Failed to fetch");
  });
});
