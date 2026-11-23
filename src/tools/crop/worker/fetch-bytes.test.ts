import { describe, expect, it, vi } from "vitest";
import { fetchBytes } from "./fetch-bytes";

describe("fetchBytes", () => {
  it("returns the body of a successful response", async () => {
    const body = Uint8Array.of(1, 2, 3).buffer;
    const fetcher = vi.fn(
      async () =>
        ({ ok: true, status: 200, arrayBuffer: async () => body }) as Response,
    );
    await expect(fetchBytes("/wasm/x.wasm", fetcher)).resolves.toBe(body);
    expect(fetcher).toHaveBeenCalledWith("/wasm/x.wasm");
  });

  it("fails on an HTTP error instead of returning the error page", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    await expect(fetchBytes("/wasm/x.wasm", fetcher)).rejects.toThrow(
      "Could not download /wasm/x.wasm (HTTP 404).",
    );
  });
});
