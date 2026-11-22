// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { imageKey } from "./image-key";

const parts = { width: 4, height: 3, filters: ["FlateDecode"], colorspace: 7 };

describe("imageKey", () => {
  it("combines size, filters, colour space and the SHA-256 of the raw bytes", async () => {
    const raw = new Uint8Array([1, 2, 3]);
    const sha = createHash("sha256").update(raw).digest("hex");
    expect(await imageKey(raw, parts)).toBe(`4x3|FlateDecode|7|${sha}`);
  });

  it("is equal for equal input and differs when anything differs", async () => {
    const raw = new Uint8Array([9, 9]);
    const key = await imageKey(raw, parts);
    expect(await imageKey(new Uint8Array([9, 9]), { ...parts })).toBe(key);
    expect(await imageKey(new Uint8Array([9, 8]), parts)).not.toBe(key);
    expect(await imageKey(raw, { ...parts, width: 5 })).not.toBe(key);
    expect(await imageKey(raw, { ...parts, filters: ["DCTDecode"] })).not.toBe(
      key,
    );
    expect(await imageKey(raw, { ...parts, colorspace: 2 })).not.toBe(key);
  });

  it("hashes only the viewed bytes of a subarray", async () => {
    const big = new Uint8Array([0, 1, 2, 3, 0]);
    expect(await imageKey(big.subarray(1, 4), parts)).toBe(
      await imageKey(new Uint8Array([1, 2, 3]), parts),
    );
  });
});
