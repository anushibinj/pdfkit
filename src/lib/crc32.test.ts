// @vitest-environment node
import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32 } from "./crc32";

const ascii = (text: string) => new TextEncoder().encode(text);

describe("crc32", () => {
  it("matches the standard check value", () => {
    // The CRC-32 "check" value from the catalogue of parametrised CRCs.
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for no data", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("agrees with zlib on arbitrary bytes", () => {
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 131) & 0xff);
    expect(crc32(bytes)).toBe(zlibCrc32(bytes));
  });

  it("continues a checksum across pieces", () => {
    const whole = ascii("The quick brown fox jumps over the lazy dog");
    const split = crc32(whole.subarray(10), crc32(whole.subarray(0, 10)));
    expect(split).toBe(crc32(whole));
    expect(crc32(whole)).toBe(0x414fa339);
  });
});
