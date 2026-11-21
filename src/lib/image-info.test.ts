import { describe, expect, it } from "vitest";
import { GREEN_JPEG, makePng } from "@/lib/test-utils/images";
import { jpegSize, pngSize, readImageInfo } from "./image-info";

describe("pngSize", () => {
  it("reads width and height from IHDR", () => {
    expect(pngSize(makePng(300, 7, () => [0, 0, 0, 255]))).toEqual({
      width: 300,
      height: 7,
    });
  });

  it("rejects other data", () => {
    expect(pngSize(new Uint8Array(30))).toBeNull();
    expect(pngSize(GREEN_JPEG)).toBeNull();
    // right signature, wrong first chunk
    const broken = makePng(1, 1, () => [0, 0, 0, 0]);
    broken[12] = 0x58;
    expect(pngSize(broken)).toBeNull();
  });
});

describe("jpegSize", () => {
  it("reads the frame header of a real JPEG", () => {
    expect(jpegSize(GREEN_JPEG)).toEqual({ width: 8, height: 8 });
  });

  it("hops over segments and fill bytes to find the frame", () => {
    const bytes = new Uint8Array([
      0xff,
      0xd8, // start of image
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00, // APP0 with 2 payload bytes
      0xff,
      0xff, // fill byte
      0xff,
      0xc2,
      0x00,
      0x0b,
      0x08,
      0x01,
      0x2c,
      0x00,
      0x96, // progressive SOF: 300 x 150
    ]);
    expect(jpegSize(bytes)).toEqual({ width: 150, height: 300 });
  });

  it("does not mistake Huffman tables for a frame", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc4, 0x00, 0x04, 0x01, 0x02, 0xff, 0xd9,
    ]);
    expect(jpegSize(bytes)).toBeNull();
  });

  it("rejects non-JPEG and truncated data", () => {
    expect(jpegSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(jpegSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(
      jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08])),
    ).toBeNull();
    expect(
      jpegSize(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00])),
    ).toBeNull();
    expect(
      jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00])),
    ).toBeNull();
  });
});

describe("readImageInfo", () => {
  it("identifies PNGs and JPEGs by content", () => {
    expect(readImageInfo(makePng(4, 2, () => [0, 0, 0, 255]))).toEqual({
      mime: "image/png",
      width: 4,
      height: 2,
    });
    expect(readImageInfo(GREEN_JPEG)).toEqual({
      mime: "image/jpeg",
      width: 8,
      height: 8,
    });
  });

  it("rejects other formats and empty images", () => {
    expect(
      readImageInfo(new TextEncoder().encode("GIF89a........")),
    ).toBeNull();
    expect(readImageInfo(makePng(0, 5, () => [0, 0, 0, 0]))).toBeNull();
  });
});
