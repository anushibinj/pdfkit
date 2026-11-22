import { describe, expect, it } from "vitest";
import {
  BITMAP_FORMAT,
  bitmapToRgba,
  bytesPerPixelOf,
  unpremultiply,
} from "./bitmap-format";

describe("bytesPerPixelOf", () => {
  it("knows every PDFium format and rejects the rest", () => {
    expect(bytesPerPixelOf(BITMAP_FORMAT.GRAY)).toBe(1);
    expect(bytesPerPixelOf(BITMAP_FORMAT.BGR)).toBe(3);
    expect(bytesPerPixelOf(BITMAP_FORMAT.BGRX)).toBe(4);
    expect(bytesPerPixelOf(BITMAP_FORMAT.BGRA)).toBe(4);
    expect(bytesPerPixelOf(BITMAP_FORMAT.BGRA_PREMUL)).toBe(4);
    expect(() => bytesPerPixelOf(BITMAP_FORMAT.UNKNOWN)).toThrow(/Unsupported/);
  });
});

describe("unpremultiply", () => {
  it("divides by alpha, rounds, caps and zeroes transparent pixels", () => {
    expect(unpremultiply(64, 128)).toBe(128);
    expect(unpremultiply(255, 255)).toBe(255);
    expect(unpremultiply(130, 128)).toBe(255); // capped
    expect(unpremultiply(50, 0)).toBe(0);
  });
});

describe("bitmapToRgba", () => {
  it("expands gray to RGB with opaque alpha and skips row padding", () => {
    const out = bitmapToRgba({
      width: 2,
      height: 2,
      stride: 4, // 2 bytes of pixels + 2 of padding per row
      format: BITMAP_FORMAT.GRAY,
      data: new Uint8Array([10, 20, 99, 99, 30, 40, 99, 99]),
    });
    expect(Array.from(out)).toEqual([
      10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255,
    ]);
  });

  it("swaps BGR into RGB", () => {
    const out = bitmapToRgba({
      width: 1,
      height: 1,
      stride: 3,
      format: BITMAP_FORMAT.BGR,
      data: new Uint8Array([1, 2, 3]),
    });
    expect(Array.from(out)).toEqual([3, 2, 1, 255]);
  });

  it("ignores the unused byte of BGRx", () => {
    const out = bitmapToRgba({
      width: 1,
      height: 1,
      stride: 4,
      format: BITMAP_FORMAT.BGRX,
      data: new Uint8Array([1, 2, 3, 0]),
    });
    expect(Array.from(out)).toEqual([3, 2, 1, 255]);
  });

  it("keeps straight alpha and unpremultiplies premultiplied alpha", () => {
    const straight = bitmapToRgba({
      width: 1,
      height: 1,
      stride: 4,
      format: BITMAP_FORMAT.BGRA,
      data: new Uint8Array([255, 0, 0, 128]),
    });
    expect(Array.from(straight)).toEqual([0, 0, 255, 128]);
    const premultiplied = bitmapToRgba({
      width: 1,
      height: 1,
      stride: 4,
      format: BITMAP_FORMAT.BGRA_PREMUL,
      data: new Uint8Array([64, 0, 32, 128]),
    });
    expect(Array.from(premultiplied)).toEqual([64, 0, 128, 128]);
  });

  it("rejects a buffer too short for its size", () => {
    expect(() =>
      bitmapToRgba({
        width: 2,
        height: 2,
        stride: 6,
        format: BITMAP_FORMAT.BGR,
        data: new Uint8Array(8),
      }),
    ).toThrow(/smaller than its size/);
    expect(() =>
      bitmapToRgba({
        width: 2,
        height: 1,
        stride: 2, // less than 2 pixels * 3 bytes
        format: BITMAP_FORMAT.BGR,
        data: new Uint8Array(6),
      }),
    ).toThrow(/smaller than its size/);
  });
});
