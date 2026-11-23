// @vitest-environment node
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { deflateZlib } from "./deflate";

describe("deflateZlib", () => {
  it("produces a zlib stream (RFC 1950) that inflates back to the input", async () => {
    const input = Uint8Array.from(
      { length: 200_000 },
      (_, i) => (i % 97) & 0xff,
    );
    const out = await deflateZlib(input);
    // zlib header: CM = 8 (deflate) and (CMF * 256 + FLG) % 31 === 0.
    expect(out[0] & 0x0f).toBe(8);
    expect(((out[0] << 8) | out[1]) % 31).toBe(0);
    expect(out.length).toBeLessThan(input.length);
    expect(new Uint8Array(inflateSync(out))).toEqual(input);
  }, 20_000);

  it("handles empty input", async () => {
    expect(inflateSync(await deflateZlib(new Uint8Array(0))).length).toBe(0);
  });
});
