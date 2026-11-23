import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { describe, expect, it, vi } from "vitest";
import { BITMAP_FORMAT } from "../core/bitmap-format";
import { COLORSPACE } from "../core/jpeg-passthrough";
import { fakeImagesPdfium } from "../test-utils/fake-images-pdfium";
import {
  DecodedBitmapStrategy,
  ImageTooLargeError,
  MAX_DECODED_PIXELS,
  MaskedRenderStrategy,
  NativeImageRenderer,
  OriginalJpegStrategy,
  PROBE_SIZE,
  RenderedTransparencyProbe,
  assertDecodable,
  hasClipPath,
  isOpaque,
  defaultStrategies,
  extractImage,
  readBitmap,
  type ExtractionContext,
  type ImageExtractionStrategy,
} from "./extraction-strategies";
import type { EmbeddedImage } from "./image-inspector";

const JPEG_START = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function image(overrides: Partial<EmbeddedImage> = {}): EmbeddedImage {
  return {
    object: 50,
    width: 2,
    height: 1,
    filters: ["FlateDecode"],
    colorspace: COLORSPACE.DEVICE_RGB,
    iccColourSpace: null,
    raw: new Uint8Array([1, 2, 3]),
    paintColor: null,
    ...overrides,
  };
}

function setup() {
  const { api, runtime } = fakeImagesPdfium();
  const heap = new WasmHeap(runtime);
  /** Put a 2 x 1 BGRA bitmap in fake memory and point the getters at it. */
  const bitmapPixels = () => {
    const buffer = heap.copyIn(new Uint8Array([3, 2, 1, 255, 30, 20, 10, 128]));
    api.FPDFBitmap_GetWidth.mockReturnValue(2);
    api.FPDFBitmap_GetHeight.mockReturnValue(1);
    api.FPDFBitmap_GetStride.mockReturnValue(8);
    api.FPDFBitmap_GetFormat.mockReturnValue(BITMAP_FORMAT.BGRA);
    api.FPDFBitmap_GetBuffer.mockReturnValue(buffer);
    return buffer;
  };
  const context = (img = image()): ExtractionContext => ({
    doc: 1,
    page: 2,
    image: img,
  });
  return { api, runtime, heap, bitmapPixels, context };
}

describe("assertDecodable and ImageTooLargeError", () => {
  it("accepts images up to the limit and refuses larger ones", () => {
    expect(() =>
      assertDecodable(image({ width: MAX_DECODED_PIXELS, height: 1 })),
    ).not.toThrow();
    const big = image({ width: 10_000, height: 10_000 });
    expect(() => assertDecodable(big)).toThrow(ImageTooLargeError);
    const err = new ImageTooLargeError(10_000, 9_000);
    expect(err.message).toMatch(/10000 x 9000 pixels/);
    expect([err.name, err.width, err.height]).toEqual([
      "ImageTooLargeError",
      10_000,
      9_000,
    ]);
  });
});

describe("readBitmap", () => {
  it("converts the bitmap in engine memory to RGBA", () => {
    const { api, heap, bitmapPixels } = setup();
    const buffer = bitmapPixels();
    expect(readBitmap(api, 9)).toEqual({
      width: 2,
      height: 1,
      pixels: new Uint8Array([1, 2, 3, 255, 10, 20, 30, 128]),
    });
    expect(api.FPDFBitmap_Destroy).not.toHaveBeenCalled();
    heap.free(buffer);
  });
});

describe("hasClipPath and isOpaque", () => {
  it("treats -1 paths as no clip and anything else as a clip", () => {
    const { api } = setup();
    expect(hasClipPath(api, 50)).toBe(false);
    api.FPDFClipPath_CountPaths.mockReturnValue(0); // a text clip
    expect(hasClipPath(api, 50)).toBe(true);
    api.FPDFClipPath_CountPaths.mockReturnValue(2);
    expect(hasClipPath(api, 50)).toBe(true);
  });

  it("is opaque only when every alpha is 255", () => {
    expect(isOpaque(new Uint8Array([9, 9, 9, 255, 1, 1, 1, 255]))).toBe(true);
    expect(isOpaque(new Uint8Array([9, 9, 9, 255, 1, 1, 1, 254]))).toBe(false);
    expect(isOpaque(new Uint8Array(0))).toBe(true);
  });
});

describe("NativeImageRenderer", () => {
  it("draws at the given size with opacity reset, then restores the matrix", () => {
    const { api, runtime, heap, bitmapPixels, context } = setup();
    const buffer = bitmapPixels();
    const log: string[] = [];
    api.FPDFPageObj_GetMatrix.mockImplementation((_o, ptr) => {
      [40, 0, 0, 30, 10, 10].forEach((v, i) =>
        runtime.setValue(ptr + i * 4, v),
      );
      return true;
    });
    api.FPDFPageObj_SetMatrix.mockImplementation((_o, ptr) => {
      const m = [0, 1, 2, 3, 4, 5].map((i) => runtime.floats.get(ptr + i * 4));
      log.push(`matrix ${m.join(",")}`);
      return true;
    });
    api.FPDFPageObj_SetFillColor.mockImplementation((_o, r, g, b, a) => {
      log.push(`fill ${r},${g},${b},${a}`);
      return true;
    });
    api.FPDFImageObj_GetRenderedBitmap.mockImplementation((doc, page, obj) => {
      log.push(`render ${doc} ${page} ${obj}`);
      return 77;
    });
    api.FPDFBitmap_Destroy.mockImplementation((b) => {
      log.push(`destroy ${b}`);
    });

    const pixels = new NativeImageRenderer(api, heap).render(context(), 2, 1);

    expect(pixels).toEqual({
      width: 2,
      height: 1,
      pixels: new Uint8Array([1, 2, 3, 255, 10, 20, 30, 128]),
    });
    expect(log).toEqual([
      "matrix 2,0,0,1,0,0",
      "fill 0,0,0,255",
      "render 1 2 50",
      "destroy 77",
      "matrix 40,0,0,30,10,10",
    ]);
    heap.free(buffer);
    expect(runtime.leaks()).toEqual([]);
  });

  it("keeps a stencil mask's fill colour", () => {
    const { api, runtime, heap, bitmapPixels, context } = setup();
    const buffer = bitmapPixels();
    api.FPDFPageObj_GetFillColor.mockImplementation((_o, r, g, b, a) => {
      [200, 10, 20, 128].forEach((v, i) =>
        runtime.setValue([r, g, b, a][i], v),
      );
      return true;
    });
    new NativeImageRenderer(api, heap).render(context(), 2, 1);
    expect(api.FPDFPageObj_SetFillColor).toHaveBeenCalledWith(
      50,
      200,
      10,
      20,
      255,
    );
    heap.free(buffer);
  });

  it("returns null when the matrix cannot be read, or nothing is drawn", () => {
    const { api, runtime, heap, context } = setup();
    const renderer = new NativeImageRenderer(api, heap);
    api.FPDFPageObj_GetMatrix.mockReturnValueOnce(false);
    expect(renderer.render(context(), 2, 1)).toBeNull();
    expect(api.FPDFPageObj_SetMatrix).not.toHaveBeenCalled();

    api.FPDFImageObj_GetRenderedBitmap.mockReturnValue(0);
    expect(renderer.render(context(), 2, 1)).toBeNull();
    // set to the target size, then restored
    expect(api.FPDFPageObj_SetMatrix).toHaveBeenCalledTimes(2);
    expect(api.FPDFBitmap_Destroy).not.toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });
});

/** A renderer stand-in answering with fixed pixels (or null). */
function fakeRenderer(pixels: Uint8Array | null) {
  return {
    render: vi.fn((_c: ExtractionContext, width: number, height: number) =>
      pixels ? { width, height, pixels } : null,
    ),
  };
}

describe("RenderedTransparencyProbe", () => {
  const opaque = new Uint8Array([1, 2, 3, 255]);
  const transparent = new Uint8Array([1, 2, 3, 255, 1, 2, 3, 0]);

  it("draws the image at most PROBE_SIZE pixels long, keeping its shape", () => {
    const { api, context } = setup();
    const renderer = fakeRenderer(opaque);
    const probe = new RenderedTransparencyProbe(renderer, api);
    probe.hasTransparency(context(image({ width: 4000, height: 3000 })));
    expect(renderer.render.mock.calls[0].slice(1)).toEqual([PROBE_SIZE, 384]);
    probe.hasTransparency(context(image({ width: 100, height: 50 })));
    expect(renderer.render.mock.calls[1].slice(1)).toEqual([100, 50]);
    probe.hasTransparency(context(image({ width: 1, height: 9000 })));
    expect(renderer.render.mock.calls[2].slice(1)).toEqual([1, PROBE_SIZE]);
  });

  it("reports transparency only when some alpha is below 255", () => {
    const { api, context } = setup();
    expect(
      new RenderedTransparencyProbe(fakeRenderer(opaque), api).hasTransparency(
        context(),
      ),
    ).toBe(false);
    expect(
      new RenderedTransparencyProbe(
        fakeRenderer(transparent),
        api,
      ).hasTransparency(context()),
    ).toBe(true);
    expect(
      new RenderedTransparencyProbe(fakeRenderer(null), api).hasTransparency(
        context(),
      ),
    ).toBe(false);
  });

  it("cannot tell for clipped images or images too large to decode", () => {
    const { api, context } = setup();
    const renderer = fakeRenderer(transparent);
    const probe = new RenderedTransparencyProbe(renderer, api);
    expect(
      probe.hasTransparency(context(image({ width: 10_000, height: 10_000 }))),
    ).toBe(false);
    api.FPDFClipPath_CountPaths.mockReturnValue(1);
    expect(probe.hasTransparency(context())).toBe(false);
    expect(renderer.render).not.toHaveBeenCalled();
  });
});

describe("OriginalJpegStrategy", () => {
  const jpeg = image({ filters: ["DCTDecode"], raw: JPEG_START });
  const probe = (transparent: boolean) => ({
    hasTransparency: vi.fn(() => transparent),
  });

  it("keeps an opaque gray or RGB JPEG's bytes", () => {
    const { context } = setup();
    const opaque = probe(false);
    expect(new OriginalJpegStrategy(opaque).extract(context(jpeg))).toEqual({
      method: "original-jpeg",
      mimeType: "image/jpeg",
      bytes: JPEG_START,
    });
    expect(opaque.hasTransparency).toHaveBeenCalledWith(context(jpeg));
  });

  it("leaves a JPEG with transparency to the next strategy", () => {
    const { context } = setup();
    expect(
      new OriginalJpegStrategy(probe(true)).extract(context(jpeg)),
    ).toBeNull();
  });

  it("passes on other images and on streams without a JPEG marker, without probing", () => {
    const { context } = setup();
    const unused = probe(false);
    const strategy = new OriginalJpegStrategy(unused);
    expect(strategy.extract(context(image()))).toBeNull();
    expect(
      strategy.extract(
        context({ ...jpeg, colorspace: COLORSPACE.DEVICE_CMYK }),
      ),
    ).toBeNull();
    expect(
      strategy.extract(context({ ...jpeg, raw: new Uint8Array([0, 0, 0]) })),
    ).toBeNull();
    expect(unused.hasTransparency).not.toHaveBeenCalled();
  });
});

describe("MaskedRenderStrategy", () => {
  it("draws the image at its own pixel size", () => {
    const { api, context } = setup();
    const renderer = fakeRenderer(new Uint8Array(8));
    const result = new MaskedRenderStrategy(renderer, api).extract(context());
    expect(renderer.render).toHaveBeenCalledWith(context(), 2, 1);
    expect(result).toMatchObject({
      method: "decoded-with-alpha",
      pixels: { width: 2, height: 1 },
    });
  });

  it.each([0, 1, 3])(
    "passes on an image with a clip path (%i paths)",
    (paths) => {
      const { api, context } = setup();
      api.FPDFClipPath_CountPaths.mockReturnValue(paths);
      const renderer = fakeRenderer(new Uint8Array(8));
      expect(
        new MaskedRenderStrategy(renderer, api).extract(context()),
      ).toBeNull();
      expect(renderer.render).not.toHaveBeenCalled();
    },
  );

  it("passes on when nothing is drawn, and refuses images too large to decode", () => {
    const { api, context } = setup();
    expect(
      new MaskedRenderStrategy(fakeRenderer(null), api).extract(context()),
    ).toBeNull();
    const big = image({ width: 10_000, height: 10_000 });
    expect(() =>
      new MaskedRenderStrategy(fakeRenderer(null), api).extract(context(big)),
    ).toThrow(ImageTooLargeError);
  });
});

describe("DecodedBitmapStrategy", () => {
  it("decodes with GetBitmap and destroys the bitmap", () => {
    const { api, heap, bitmapPixels, context } = setup();
    const buffer = bitmapPixels();
    api.FPDFImageObj_GetBitmap.mockReturnValue(66);
    const result = new DecodedBitmapStrategy(api).extract(context());
    expect(result).toMatchObject({
      method: "decoded",
      pixels: { width: 2, height: 1 },
    });
    expect(api.FPDFImageObj_GetBitmap).toHaveBeenCalledWith(50);
    expect(api.FPDFBitmap_Destroy).toHaveBeenCalledWith(66);
    heap.free(buffer);
  });

  it("passes on when PDFium cannot decode, and refuses huge images", () => {
    const { api, context } = setup();
    api.FPDFImageObj_GetBitmap.mockReturnValue(0);
    expect(new DecodedBitmapStrategy(api).extract(context())).toBeNull();
    expect(() =>
      new DecodedBitmapStrategy(api).extract(
        context(image({ width: 10_000, height: 10_000 })),
      ),
    ).toThrow(ImageTooLargeError);
  });
});

describe("extractImage and defaultStrategies", () => {
  const fixed = (result: ReturnType<ImageExtractionStrategy["extract"]>) => ({
    extract: vi.fn(() => result),
  });

  it("returns the first result and does not ask later strategies", () => {
    const { context } = setup();
    const found = {
      method: "decoded" as const,
      pixels: { width: 1, height: 1, pixels: new Uint8Array(4) },
    };
    const first = fixed(null);
    const second = fixed(found);
    const third = fixed(null);
    expect(extractImage([first, second, third], context())).toBe(found);
    expect(third.extract).not.toHaveBeenCalled();
  });

  it("throws when no strategy can extract the image", () => {
    const { context } = setup();
    expect(() => extractImage([fixed(null)], context())).toThrow(
      /could not decode/,
    );
  });

  it("orders the defaults best first", () => {
    const { api, heap } = setup();
    const chain = defaultStrategies(api, heap);
    expect(chain.map((s) => s.constructor)).toEqual([
      OriginalJpegStrategy,
      MaskedRenderStrategy,
      DecodedBitmapStrategy,
    ]);
  });
});
