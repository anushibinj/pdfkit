// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSignatures, hexToBytes, indexOfBytes } from "./pdf-signature-scan";

const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * Build a minimal byte string with one well-formed `/ByteRange` whose gap is
 * exactly the `<hex>` string, as a signer would write it.
 */
function fakeSigned(hex = "3082"): Uint8Array {
  const head = "%PDF-1.7 /ByteRange [0 AAAA BBBB CCCC] /Contents ";
  const tail = " endobj %%EOF";
  const gapStart = head.length;
  const c = gapStart + hex.length + 2;
  const d = tail.length;
  const pad = (n: number) => String(n).padStart(4, "0");
  const text =
    head
      .replace("AAAA", pad(gapStart))
      .replace("BBBB", pad(c))
      .replace("CCCC", pad(d)) +
    `<${hex}>` +
    tail;
  return bytes(text);
}

describe("indexOfBytes", () => {
  it("finds a needle and respects the start index", () => {
    const hay = bytes("abcabc");
    expect(indexOfBytes(hay, bytes("bc"), 0)).toBe(1);
    expect(indexOfBytes(hay, bytes("bc"), 2)).toBe(4);
  });

  it("returns -1 when absent or when the needle is longer than the rest", () => {
    expect(indexOfBytes(bytes("abc"), bytes("x"), 0)).toBe(-1);
    expect(indexOfBytes(bytes("abc"), bytes("bcd"), 0)).toBe(-1);
  });
});

describe("hexToBytes", () => {
  it("decodes hex digits, ignoring whitespace and case", () => {
    expect(Array.from(hexToBytes("30 82\nfF")!)).toEqual([0x30, 0x82, 0xff]);
  });

  it("rejects an odd number of digits or non-hex characters", () => {
    expect(hexToBytes("abc")).toBeNull();
    expect(hexToBytes("zz")).toBeNull();
  });
});

describe("findSignatures", () => {
  it("finds the signature in the signed fixture", () => {
    const signed = new Uint8Array(
      readFileSync(new URL("../../fixtures/signed.pdf", import.meta.url)),
    );
    const { found, skipped } = findSignatures(signed);
    expect(found).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it("reads the byte range and the contents of a well-formed signature", () => {
    const pdf = fakeSigned("3082");
    const { found } = findSignatures(pdf);
    expect(found).toHaveLength(1);
    expect(found[0].byteRange[0]).toBe(0);
    expect(Array.from(found[0].contents)).toEqual([0x30, 0x82]);
  });

  it("finds nothing in an unsigned PDF", () => {
    expect(findSignatures(bytes("%PDF-1.7 no signatures %%EOF"))).toEqual({
      found: [],
      skipped: 0,
    });
  });

  it("skips malformed candidates", () => {
    expect(findSignatures(bytes("/ByteRange [not numbers]")).skipped).toBe(1);
    // ranges that run past the end of the file
    expect(findSignatures(bytes("/ByteRange [0 1 2 999]")).skipped).toBe(1);
    // empty contents
    expect(findSignatures(fakeSigned("")).skipped).toBe(1);
  });
});
