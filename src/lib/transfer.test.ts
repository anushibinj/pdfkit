import { describe, expect, it } from "vitest";
import { toTransferableBuffer } from "./transfer";

describe("toTransferableBuffer", () => {
  it("reuses a buffer the view fully covers", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(toTransferableBuffer(bytes)).toBe(bytes.buffer);
  });

  it("copies a partial view into an exact-size buffer", () => {
    const big = new Uint8Array([9, 1, 2, 3, 9]);
    const out = toTransferableBuffer(big.subarray(1, 4));
    expect(out).not.toBe(big.buffer);
    expect(Array.from(new Uint8Array(out))).toEqual([1, 2, 3]);
  });
});
