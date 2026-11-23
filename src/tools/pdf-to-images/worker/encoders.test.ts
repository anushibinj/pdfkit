// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEncoders,
  createJpegEncoder,
  platformCanvas,
  type CanvasLike,
} from "./encoders";

const image = {
  width: 2,
  height: 1,
  pixels: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
};

/** A canvas recording what was drawn and answering with a fixed blob. */
function fakeCanvas(blob: Blob, withContext = true) {
  const drawn: { data: unknown; x: number; y: number }[] = [];
  const canvas: CanvasLike = {
    getContext: () =>
      withContext
        ? { putImageData: (data, x, y) => drawn.push({ data, x, y }) }
        : null,
    convertToBlob: vi.fn(async () => blob),
  };
  const createCanvas = vi.fn(() => canvas);
  const createImageData = vi.fn(
    (pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) =>
      ({ data: pixels, width, height }) as unknown as ImageData,
  );
  return { canvas, drawn, createCanvas, createImageData };
}

afterEach(() => vi.unstubAllGlobals());

describe("platformCanvas", () => {
  it("is null without OffscreenCanvas", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    expect(platformCanvas()).toBeNull();
  });

  it("wraps OffscreenCanvas and ImageData when present", () => {
    const Canvas = vi.fn(function (this: object, w: number, h: number) {
      Object.assign(this, { w, h });
    });
    const Data = vi.fn(function (
      this: object,
      d: unknown,
      w: number,
      h: number,
    ) {
      Object.assign(this, { d, w, h });
    });
    vi.stubGlobal("OffscreenCanvas", Canvas);
    vi.stubGlobal("ImageData", Data);
    const platform = platformCanvas();
    expect(platform?.createCanvas(3, 4)).toMatchObject({ w: 3, h: 4 });
    const pixels = new Uint8ClampedArray(4);
    expect(platform?.createImageData(pixels, 1, 1)).toMatchObject({
      d: pixels,
    });
  });
});

describe("createJpegEncoder", () => {
  it("draws the exact pixels and asks for a JPEG at the quality", async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8])], {
      type: "image/jpeg",
    });
    const fake = fakeCanvas(jpeg);
    const encode = createJpegEncoder(fake);
    expect(Array.from(await encode(image, 0.7))).toEqual([0xff, 0xd8]);
    expect(fake.createCanvas).toHaveBeenCalledWith(2, 1);
    expect(fake.drawn).toHaveLength(1);
    expect(fake.drawn[0]).toMatchObject({ x: 0, y: 0 });
    const [pixels, w, h] = fake.createImageData.mock.calls[0];
    expect([Array.from(pixels), w, h]).toEqual([
      Array.from(image.pixels),
      2,
      1,
    ]);
    expect(fake.canvas.convertToBlob).toHaveBeenCalledWith({
      type: "image/jpeg",
      quality: 0.7,
    });
  });

  it("refuses when the browser falls back to another format", async () => {
    const png = new Blob([new Uint8Array([0x89])], { type: "image/png" });
    await expect(createJpegEncoder(fakeCanvas(png))(image, 1)).rejects.toThrow(
      /could not encode JPEG/,
    );
  });

  it("explains a missing canvas or 2D context", async () => {
    await expect(createJpegEncoder(null)(image, 1)).rejects.toThrow(
      /cannot create JPEG files/,
    );
    const noContext = fakeCanvas(new Blob([]), false);
    await expect(createJpegEncoder(noContext)(image, 1)).rejects.toThrow(
      /Could not create a canvas/,
    );
  });
});

describe("createEncoders", () => {
  it("encodes PNG losslessly with the platform's zlib", async () => {
    const png = await createEncoders(null).png(image);
    expect(Array.from(png.subarray(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
  });
});
