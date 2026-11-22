// @vitest-environment node
import sharp from "sharp";
import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { deflateZlib } from "./deflate";
import {
  MAX_IDAT_CHUNK,
  PNG_COLOR_TYPE,
  assemblePng,
  bytesPerPixel,
  chooseColorType,
  encodePng,
  filterScanlines,
  ihdrData,
  packPixels,
  paeth,
  type RgbaImage,
} from "./png-encoder";

/** Build an RGBA image from a per-pixel function. */
function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      pixels.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, pixels };
}

/** Decode a PNG with sharp (libvips), an independent decoder, to RGBA. */
async function decode(png: Uint8Array) {
  const { data, info } = await sharp(png)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    pixels: new Uint8Array(data),
  };
}

/** Read the colour type byte from a PNG's IHDR. */
const colorTypeOf = (png: Uint8Array) => png[8 + 8 + 9];

describe("chooseColorType", () => {
  it.each([
    ["opaque gray", [10, 10, 10, 255, 200, 200, 200, 255], PNG_COLOR_TYPE.GRAY],
    ["opaque colour", [10, 10, 10, 255, 1, 2, 3, 255], PNG_COLOR_TYPE.RGB],
    [
      "gray with alpha",
      [10, 10, 10, 0, 7, 7, 7, 255],
      PNG_COLOR_TYPE.GRAY_ALPHA,
    ],
    ["colour with alpha", [10, 10, 10, 255, 1, 2, 3, 128], PNG_COLOR_TYPE.RGBA],
  ])("%s", (_label, bytes, expected) => {
    expect(chooseColorType(new Uint8Array(bytes))).toBe(expected);
  });

  it("counts a transparent coloured pixel as colour, so nothing is lost", () => {
    expect(chooseColorType(new Uint8Array([255, 0, 0, 0]))).toBe(
      PNG_COLOR_TYPE.RGBA,
    );
  });
});

describe("bytesPerPixel", () => {
  it("is 1, 2, 3 and 4 for gray, gray+alpha, RGB and RGBA", () => {
    expect(bytesPerPixel(PNG_COLOR_TYPE.GRAY)).toBe(1);
    expect(bytesPerPixel(PNG_COLOR_TYPE.GRAY_ALPHA)).toBe(2);
    expect(bytesPerPixel(PNG_COLOR_TYPE.RGB)).toBe(3);
    expect(bytesPerPixel(PNG_COLOR_TYPE.RGBA)).toBe(4);
  });
});

describe("packPixels", () => {
  const rgba = new Uint8Array([1, 1, 1, 9, 2, 2, 2, 8]);
  it("keeps one sample per channel of the colour type", () => {
    expect(Array.from(packPixels(rgba, PNG_COLOR_TYPE.GRAY))).toEqual([1, 2]);
    expect(Array.from(packPixels(rgba, PNG_COLOR_TYPE.GRAY_ALPHA))).toEqual([
      1, 9, 2, 8,
    ]);
    expect(Array.from(packPixels(rgba, PNG_COLOR_TYPE.RGB))).toEqual([
      1, 1, 1, 2, 2, 2,
    ]);
    expect(packPixels(rgba, PNG_COLOR_TYPE.RGBA)).toBe(rgba);
  });
});

describe("paeth", () => {
  it("picks the neighbour closest to a + b - c, preferring a, then b", () => {
    expect(paeth(10, 20, 10)).toBe(20); // p = 20 equals b
    expect(paeth(20, 10, 10)).toBe(20); // p = 20 equals a
    expect(paeth(5, 5, 5)).toBe(5); // all equal: a
    expect(paeth(1, 200, 100)).toBe(100); // p = 101 is closest to c
  });
});

describe("filterScanlines", () => {
  it("uses no filter for a first row of zeros and Up for a repeated row", () => {
    // 2 pixels x 2 rows, 1 byte per pixel; row 2 repeats row 1.
    const out = filterScanlines(new Uint8Array([0, 0, 0, 0]), 2, 2, 1);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0]);
    const repeated = filterScanlines(new Uint8Array([50, 90, 50, 90]), 2, 2, 1);
    // Row 1: Sub gives 50, 40 (score 90) vs None 50, 90 (140): Sub wins.
    expect(Array.from(repeated.subarray(0, 3))).toEqual([1, 50, 40]);
    // Row 2: Up turns it into zeros.
    expect(Array.from(repeated.subarray(3))).toEqual([2, 0, 0]);
  });

  it("wraps differences modulo 256", () => {
    // A ramp going down: Sub stores -10 as 246.
    const out = filterScanlines(new Uint8Array([100, 90, 80, 70]), 4, 1, 1);
    expect(Array.from(out)).toEqual([1, 100, 246, 246, 246]);
  });
});

describe("ihdrData", () => {
  it("writes width, height, depth 8 and the colour type", () => {
    const data = ihdrData(300, 2, PNG_COLOR_TYPE.RGB);
    expect(Array.from(data)).toEqual([0, 0, 1, 44, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  });
});

describe("assemblePng", () => {
  it("splits large data into several IDAT chunks", () => {
    const compressed = new Uint8Array(MAX_IDAT_CHUNK * 2 + 5);
    const png = assemblePng(ihdrData(1, 1, 0), compressed);
    const text = new TextDecoder("latin1").decode(png);
    expect(text.split("IDAT").length - 1).toBe(3);
    // IEND: zero length, the type, then its fixed CRC AE 42 60 82.
    expect(Array.from(png.subarray(-12))).toEqual([
      0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82,
    ]);
  });
});

describe("encodePng", () => {
  it.each([
    [
      "RGBA",
      (x: number, y: number) => [
        x * 40,
        y * 60,
        255 - x * 10,
        x === 2 ? 0 : 50 + y * 50,
      ],
    ],
    ["RGB", (x: number, y: number) => [x * 40, y * 60, 7, 255]],
    [
      "gray",
      (x: number, y: number) => [x * 30 + y, x * 30 + y, x * 30 + y, 255],
    ],
    ["gray+alpha", (x: number) => [90, 90, 90, x * 50]],
  ] as const)(
    "round-trips %s pixels exactly through an independent decoder",
    async (_label, pixel) => {
      const input = image(
        5,
        4,
        pixel as (x: number, y: number) => [number, number, number, number],
      );
      const png = await encodePng(input, deflateZlib);
      const output = await decode(png);
      expect(output.width).toBe(5);
      expect(output.height).toBe(4);
      expect(Array.from(output.pixels)).toEqual(Array.from(input.pixels));
    },
  );

  it("writes the smallest exact colour type", async () => {
    const opaqueGray = image(3, 3, () => [128, 128, 128, 255]);
    expect(colorTypeOf(await encodePng(opaqueGray, deflateZlib))).toBe(
      PNG_COLOR_TYPE.GRAY,
    );
  });

  it("compresses the filtered scanlines with the injected deflate", async () => {
    const deflate = vi.fn(deflateZlib);
    await encodePng(
      image(2, 2, () => [1, 2, 3, 255]),
      deflate,
    );
    const filtered = deflate.mock.calls[0][0];
    expect(filtered.length).toBe((2 * 3 + 1) * 2); // RGB rows + filter bytes
  });

  it("produces data a zlib inflater accepts", async () => {
    const png = await encodePng(
      image(2, 1, () => [9, 9, 9, 255]),
      deflateZlib,
    );
    const idatAt = new TextDecoder("latin1").decode(png).indexOf("IDAT");
    const length = new DataView(png.buffer).getUint32(idatAt - 4);
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length));
    expect(Array.from(raw)).toEqual([1, 9, 0]); // Sub filter: 9, then 0
  });

  it("rejects an invalid size or a mismatched buffer", async () => {
    await expect(
      encodePng(
        { width: 0, height: 1, pixels: new Uint8Array(0) },
        deflateZlib,
      ),
    ).rejects.toThrow(RangeError);
    await expect(
      encodePng(
        { width: 2, height: 2, pixels: new Uint8Array(4) },
        deflateZlib,
      ),
    ).rejects.toThrow(/does not match/);
  });
});
