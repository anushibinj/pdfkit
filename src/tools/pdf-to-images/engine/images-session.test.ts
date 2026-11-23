// @vitest-environment node
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { describe, expect, it, vi } from "vitest";
import { COLORSPACE } from "../core/jpeg-passthrough";
import { fakeImagesPdfium } from "../test-utils/fake-images-pdfium";
import {
  ImageTooLargeError,
  type ExtractedImage,
  type ImageExtractionStrategy,
} from "./extraction-strategies";
import {
  ImagesSession,
  isEngineFailure,
  type ImageEncoders,
} from "./images-session";
import { METADATA, PAGE_OBJECT } from "./pdfium-api";

function setup(extract?: ImageExtractionStrategy["extract"]) {
  const { api, runtime } = fakeImagesPdfium();
  const encoders: ImageEncoders = {
    png: vi.fn(async () => new Uint8Array([0x89, 0x50])),
    jpeg: vi.fn(async () => new Uint8Array([0xff, 0xd8])),
  };
  const strategy = { extract: vi.fn(extract ?? (() => null)) };
  const session = new ImagesSession(api, encoders, () => [strategy]);
  return { api, runtime, encoders, strategy, session };
}

/** Make page 1 a 144 x 72 point page and the bitmap a blank RGBA buffer. */
function givenPage(
  api: ReturnType<typeof setup>["api"],
  runtime: ReturnType<typeof setup>["runtime"],
  rotation = 0,
) {
  api.FPDF_GetPageBoundingBox.mockImplementation((_p, rect) => {
    [0, 72, 144, 0].forEach((v, i) => runtime.setValue(rect + i * 4, v));
    return true;
  });
  api.FPDFPage_GetRotation.mockReturnValue(rotation);
  api.FPDFBitmap_GetStride.mockImplementation(() => 0);
}

/** Make the page hold image objects 11, 12, ... with the given raw bytes. */
function givenImages(
  api: ReturnType<typeof setup>["api"],
  runtime: ReturnType<typeof setup>["runtime"],
  raws: number[][],
) {
  api.FPDFPage_CountObjects.mockReturnValue(raws.length);
  api.FPDFPage_GetObject.mockImplementation((_p, i) => 11 + i);
  api.FPDFPageObj_GetType.mockReturnValue(PAGE_OBJECT.IMAGE);
  api.FPDFImageObj_GetImagePixelSize.mockImplementation((_o, w, h) => {
    runtime.setValue(w, 2);
    runtime.setValue(h, 2);
    return true;
  });
  api.FPDFImageObj_GetImageDataRaw.mockImplementation((object, buffer) => {
    const raw = raws[object - 11];
    if (buffer) runtime.HEAPU8.set(raw, buffer);
    return raw.length;
  });
}

const decoded = { width: 2, height: 2, pixels: new Uint8Array(16) };
const pixels: ExtractedImage = {
  method: "decoded-with-alpha",
  pixels: decoded,
};

describe("isEngineFailure", () => {
  it("is true for out-of-memory errors and WebAssembly traps only", () => {
    expect(isEngineFailure(new RangeError("x"))).toBe(true);
    expect(isEngineFailure(new WebAssembly.RuntimeError("unreachable"))).toBe(
      true,
    );
    expect(isEngineFailure(new ImageTooLargeError(1, 1))).toBe(false);
    expect(isEngineFailure(new Error("bad image"))).toBe(false);
  });
});

describe("ImagesSession lifecycle", () => {
  it("open returns the page count and replaces an open document", () => {
    const { api, session } = setup();
    api.FPDF_GetPageCount.mockReturnValue(3);
    expect(session.open(new Uint8Array(1), "pw")).toBe(3);
    expect(api.FPDF_LoadMemDocument).toHaveBeenCalledWith(
      expect.any(Number),
      1,
      "pw",
    );
    session.open(new Uint8Array(1), "");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
  });

  it("open refuses a PDF without pages and closes it", () => {
    const { api, runtime, session } = setup();
    api.FPDF_GetPageCount.mockReturnValue(0);
    expect(() => session.open(new Uint8Array(1), "")).toThrow(/no pages/);
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
  });

  it("open reports PDFium's reason when it cannot open the file", () => {
    const { api, session } = setup();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.PASSWORD);
    expect(() => session.open(new Uint8Array(1), "")).toThrow(PdfOpenError);
  });

  it("close frees the document once and requests then fail", async () => {
    const { api, runtime, session } = setup();
    session.open(new Uint8Array(1), "");
    session.close();
    session.close();
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
    await expect(session.renderPage(0, {})).rejects.toThrow("No PDF is open.");
  });

  it.each([-1, 1, 0.5, Number.NaN])("rejects page index %s", async (index) => {
    const { session } = setup();
    session.open(new Uint8Array(1), "");
    await expect(session.renderPage(index, {})).rejects.toThrow(
      /does not exist/,
    );
    await expect(session.extractImages(index, [])).rejects.toThrow(
      /does not exist/,
    );
  });
});

describe("ImagesSession.renderPage", () => {
  it("renders at the size the DPI gives and encodes PNG by default", async () => {
    const { api, runtime, encoders, session } = setup();
    givenPage(api, runtime);
    session.open(new Uint8Array(1), "");
    const page = await session.renderPage(0, { dpi: 144 });
    expect(page).toMatchObject({
      pageIndex: 0,
      width: 288,
      height: 144,
      dpi: 144,
      reduced: false,
      mimeType: "image/png",
    });
    expect(Array.from(page.bytes)).toEqual([0x89, 0x50]);
    expect(api.FPDF_RenderPageBitmap).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      0,
      0,
      288,
      144,
      0,
      expect.any(Number),
    );
    expect(encoders.png).toHaveBeenCalledWith(
      expect.objectContaining({ width: 288, height: 144 }),
    );
    expect(encoders.jpeg).not.toHaveBeenCalled();
  });

  it("swaps the sides of a rotated page and encodes JPEG with the quality", async () => {
    const { api, runtime, encoders, session } = setup();
    givenPage(api, runtime, 1);
    session.open(new Uint8Array(1), "");
    const page = await session.renderPage(0, {
      format: "jpeg",
      dpi: 72,
      quality: 0.5,
    });
    expect([page.width, page.height, page.mimeType]).toEqual([
      72,
      144,
      "image/jpeg",
    ]);
    expect(encoders.jpeg).toHaveBeenCalledWith(
      expect.objectContaining({ width: 72, height: 144 }),
      0.5,
    );
  });

  it("sanitises untrusted options", async () => {
    const { api, runtime, session } = setup();
    givenPage(api, runtime);
    session.open(new Uint8Array(1), "");
    const page = await session.renderPage(0, { format: "gif", dpi: "a lot" });
    expect([page.mimeType, page.dpi]).toEqual(["image/png", 150]);
  });
});

describe("ImagesSession.extractImages", () => {
  it("extracts new images, encodes pixels as PNG and closes the page", async () => {
    const { api, runtime, encoders, strategy, session } = setup(() => pixels);
    givenImages(api, runtime, [[1, 2, 3]]);
    session.open(new Uint8Array(1), "");
    const [entry] = await session.extractImages(0, []);
    expect(entry).toMatchObject({
      kind: "image",
      width: 2,
      height: 2,
      mimeType: "image/png",
      method: "decoded-with-alpha",
    });
    expect(entry.kind === "image" && Array.from(entry.bytes)).toEqual([
      0x89, 0x50,
    ]);
    expect(strategy.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.objectContaining({ object: 11 }),
      }),
    );
    expect(encoders.png).toHaveBeenCalledWith(decoded);
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(1);
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("returns original JPEG bytes without encoding", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    const { api, runtime, encoders, session } = setup(() => ({
      method: "original-jpeg",
      mimeType: "image/jpeg",
      bytes: jpeg,
    }));
    givenImages(api, runtime, [[9]]);
    session.open(new Uint8Array(1), "");
    const [entry] = await session.extractImages(0, []);
    expect(entry).toMatchObject({
      kind: "image",
      mimeType: "image/jpeg",
      bytes: jpeg,
    });
    expect(encoders.png).not.toHaveBeenCalled();
  });

  it("reports repeats on the same page and from known keys without decoding", async () => {
    const { api, runtime, strategy, session } = setup(() => pixels);
    givenImages(api, runtime, [[1], [1], [2]]);
    session.open(new Uint8Array(1), "");
    const first = await session.extractImages(0, []);
    expect(first.map((e) => e.kind)).toEqual(["image", "repeat", "image"]);
    expect(first[1].key).toBe(first[0].key);
    expect(strategy.extract).toHaveBeenCalledTimes(2);

    const again = await session.extractImages(0, [first[0].key, first[2].key]);
    expect(again.map((e) => e.kind)).toEqual(["repeat", "repeat", "repeat"]);
    expect(strategy.extract).toHaveBeenCalledTimes(2);
  });

  it("never takes images without raw bytes for repeats", async () => {
    const { api, runtime, strategy, session } = setup(() => pixels);
    givenImages(api, runtime, [[], []]);
    session.open(new Uint8Array(1), "");
    const entries = await session.extractImages(0, []);
    expect(entries.map((e) => e.kind)).toEqual(["image", "image"]);
    expect(entries[0].key).not.toBe(entries[1].key);
    expect(strategy.extract).toHaveBeenCalledTimes(2);
  });

  it("tells image masks painted in different colours apart", async () => {
    const { api, runtime, strategy, session } = setup(() => pixels);
    givenImages(api, runtime, [[1], [1]]);
    let call = 0;
    api.FPDFPageObj_GetFillColor.mockImplementation((_o, r, g, b, a) => {
      const color = call++ === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255];
      color.forEach((v, i) => runtime.setValue([r, g, b, a][i], v));
      return true;
    });
    session.open(new Uint8Array(1), "");
    const entries = await session.extractImages(0, []);
    expect(entries.map((e) => e.kind)).toEqual(["image", "image"]);
    expect(strategy.extract).toHaveBeenCalledTimes(2);
  });

  it("skips an image it cannot extract and carries on", async () => {
    let call = 0;
    const { api, runtime, session } = setup(() => {
      call++;
      if (call === 1) throw new ImageTooLargeError(9, 9);
      return pixels;
    });
    givenImages(api, runtime, [[1], [2]]);
    session.open(new Uint8Array(1), "");
    const entries = await session.extractImages(0, []);
    expect(entries[0]).toMatchObject({
      kind: "skipped",
      width: 2,
      height: 2,
      reason: expect.stringMatching(/too large/),
    });
    expect(entries[1].kind).toBe("image");
  });

  it("fails the request on an engine failure and still closes the page", async () => {
    const { api, runtime, session } = setup(() => {
      throw new RangeError("out of memory");
    });
    givenImages(api, runtime, [[1]]);
    session.open(new Uint8Array(1), "");
    await expect(session.extractImages(0, [])).rejects.toThrow(RangeError);
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(1);
  });

  it("ignores image objects PDFium reports no size for", async () => {
    const { api, runtime, strategy, session } = setup(() => pixels);
    givenImages(api, runtime, [[1]]);
    api.FPDFImageObj_GetImagePixelSize.mockReturnValue(false);
    session.open(new Uint8Array(1), "");
    expect(await session.extractImages(0, [])).toEqual([]);
    expect(strategy.extract).not.toHaveBeenCalled();
  });

  it("uses the default strategy chain when none is injected", async () => {
    const { api, runtime } = fakeImagesPdfium();
    const jpeg = [0xff, 0xd8, 0xff, 0xe0];
    givenImages(api, runtime, [jpeg]);
    // A DeviceRGB image whose only filter is DCTDecode: a plain JPEG.
    api.FPDFImageObj_GetImageFilterCount.mockReturnValue(1);
    api.FPDFImageObj_GetImageFilter.mockImplementation((_o, _i, buffer) => {
      const name = new TextEncoder().encode("DCTDecode\0");
      if (buffer) runtime.HEAPU8.set(name, buffer);
      return name.length;
    });
    api.FPDFImageObj_GetImageMetadata.mockImplementation((_o, _p, ptr) => {
      runtime.setValue(ptr + METADATA.COLORSPACE_OFFSET, COLORSPACE.DEVICE_RGB);
      return true;
    });
    const png = vi.fn();
    const session = new ImagesSession(api, { png, jpeg: vi.fn() });
    session.open(new Uint8Array(1), "");
    const [entry] = await session.extractImages(0, []);
    expect(entry).toMatchObject({ kind: "image", method: "original-jpeg" });
    expect(entry.kind === "image" && Array.from(entry.bytes)).toEqual(jpeg);
    expect(png).not.toHaveBeenCalled();
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });
});
