// @vitest-environment node
import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32 } from "./crc32";

const ascii = (text: string) => new TextEncoder().encode(text);

describe("crc32", () => {
  it("matches the standard check value", () => {
    // The CRC-32 catalogue's check value for "123456789".
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });

  it.each([
    ["", 0x00000000],
    ["a", 0xe8b7be43],
    ["The quick brown fox jumps over the lazy dog", 0x414fa339],
  ])("crc32(%j) = %i", (text, expected) => {
    expect(crc32(ascii(text))).toBe(expected);
  });

  it("is always an unsigned 32-bit number", () => {
    const value = crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
    expect(value).toBe(0xffffffff);
  });

  it("can continue from an earlier chunk", () => {
    const whole = crc32(ascii("hello world"));
    expect(crc32(ascii(" world"), crc32(ascii("hello")))).toBe(whole);
  });

  it("notices leading zero bytes", () => {
    expect(crc32(new Uint8Array([0, 1]))).not.toBe(crc32(new Uint8Array([1])));
  });

  it("agrees with zlib on a large buffer", () => {
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 131) & 0xff);
    expect(crc32(bytes)).toBe(zlibCrc32(bytes));
  });
});
