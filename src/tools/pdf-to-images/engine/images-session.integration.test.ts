// @vitest-environment node
/**
 * Runs the real PDFium WebAssembly build end to end: PDFs are built with
 * pdf-lib, rendered or mined for images by the session, and every output
 * file is decoded by sharp (libvips), a decoder independent of this code.
 */
import { readFileSync } from "node:fs";
import {
  PDFDocument,
  clip,
  concatTransformationMatrix,
  degrees,
  drawObject,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from "pdf-lib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/document";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node";
import { deflateZlib } from "@/lib/png/deflate";
import { encodePng, type RgbaImage } from "@/lib/png/png-encoder";
import { asImagesPdfiumApi } from "../worker/load-pdfium";
import {
  ImagesSession,
  type ImageEncoders,
  type PageImageEntry,
} from "./images-session";
import type { ImagesPdfiumApi } from "./pdfium-api";

let api: ImagesPdfiumApi;

/** Real PNG encoding; JPEG through sharp (there is no canvas in Node). */
const encoders: ImageEncoders = {
  png: (image) => encodePng(image, deflateZlib),
  jpeg: async (image, quality) =>
    new Uint8Array(
      await sharp(Buffer.from(image.pixels), {
        raw: { width: image.width, height: image.height, channels: 4 },
      })
        .jpeg({ quality: Math.round(quality * 100) })
        .toBuffer(),
    ),
};

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url)),
  );

/** Decode any image file to RGBA with sharp. */
async function decode(bytes: Uint8Array): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes)
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

/** 4 x 3 RGBA test image: green corner, red left half, half-transparent blue right half. */
const W = 4;
const H = 3;
const SOURCE: number[] = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    SOURCE.push(
      ...(x === 0 && y === 0
        ? [0, 255, 0, 255]
        : x < 2
          ? [255, 0, 0, 255]
          : [0, 0, 255, 128]),
    );
  }
}

let png: Uint8Array;
let jpeg: Uint8Array;
let grayJpeg: Uint8Array;
let cmykJpeg: Uint8Array;

beforeAll(async () => {
  api = asImagesPdfiumApi(await loadNodePdfiumModule());
  const raw = { raw: { width: W, height: H, channels: 4 as const } };
  png = new Uint8Array(await sharp(Buffer.from(SOURCE), raw).png().toBuffer());
  const solid = (channels: 3 | 4, bg: object) =>
    sharp({ create: { width: 16, height: 8, channels, background: bg } });
  jpeg = new Uint8Array(
    await solid(3, { r: 0, g: 160, b: 0 }).jpeg().toBuffer(),
  );
  grayJpeg = new Uint8Array(
    await solid(3, { r: 90, g: 90, b: 90 })
      .toColourspace("b-w")
      .jpeg()
      .toBuffer(),
  );
  cmykJpeg = new Uint8Array(
    await solid(3, { r: 200, g: 30, b: 30 })
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer(),
  );
});

/** Open a fresh session on a PDF. */
function sessionFor(bytes: Uint8Array, password = ""): ImagesSession {
  const session = new ImagesSession(api, encoders);
  session.open(bytes, password);
  return session;
}

/** The new images among the entries. */
const images = (entries: PageImageEntry[]) =>
  entries.filter(
    (e): e is Extract<PageImageEntry, { kind: "image" }> => e.kind === "image",
  );

describe("ImagesSession.renderPage (real PDFium)", () => {
  let pdf: Uint8Array;
  beforeAll(async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 100]);
    page.drawRectangle({
      x: 0,
      y: 50,
      width: 100,
      height: 50,
      color: rgb(1, 0, 0),
    });
    doc.addPage([200, 100]).setRotation(degrees(90));
    pdf = await doc.save();
  });

  it("renders at the requested DPI as a lossless PNG", async () => {
    const session = sessionFor(pdf);
    const page = await session.renderPage(0, { format: "png", dpi: 72 });
    expect(page).toMatchObject({
      width: 200,
      height: 100,
      dpi: 72,
      reduced: false,
    });
    expect(page.mimeType).toBe("image/png");
    const img = await decode(page.bytes);
    expect([img.width, img.height]).toEqual([200, 100]);
    const at = (x: number, y: number) =>
      Array.from(img.pixels.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 4));
    expect(at(10, 10)).toEqual([255, 0, 0, 255]); // red square, top left
    expect(at(150, 80)).toEqual([255, 255, 255, 255]); // white paper
    session.close();
  });

  it("doubles the pixels at 144 DPI and swaps the sides of a rotated page", async () => {
    const session = sessionFor(pdf);
    expect(await session.renderPage(0, { dpi: 144 })).toMatchObject({
      width: 400,
      height: 200,
    });
    const rotated = await session.renderPage(1, { dpi: 72 });
    expect([rotated.width, rotated.height]).toEqual([100, 200]);
    const img = await decode(rotated.bytes);
    expect([img.width, img.height]).toEqual([100, 200]);
    session.close();
  });

  it("encodes JPEG when asked", async () => {
    const session = sessionFor(pdf);
    const page = await session.renderPage(0, {
      format: "jpeg",
      dpi: 72,
      quality: 0.8,
    });
    expect(page.mimeType).toBe("image/jpeg");
    expect(Array.from(page.bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect((await sharp(page.bytes).metadata()).format).toBe("jpeg");
    session.close();
  });

  it("opens a password-protected PDF only with its password", async () => {
    const session = new ImagesSession(api, encoders);
    expect(() => session.open(fixture("user-password.pdf"), "")).toThrow(
      PdfOpenError,
    );
    expect(
      session.open(fixture("user-password.pdf"), "hunter2"),
    ).toBeGreaterThan(0);
    const page = await session.renderPage(0, { dpi: 36 });
    expect(page.bytes.length).toBeGreaterThan(0);
    session.close();
  });
});

describe("ImagesSession.extractImages (real PDFium)", () => {
  it("extracts a transparent PNG at its own size with exact pixels and alpha", async () => {
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    doc
      .addPage([300, 300])
      .drawImage(img, { x: 10, y: 10, width: 120, height: 90 });
    const session = sessionFor(await doc.save());
    const [entry] = images(await session.extractImages(0, []));
    expect(entry).toMatchObject({
      width: W,
      height: H,
      mimeType: "image/png",
      method: "decoded-with-alpha",
    });
    const out = await decode(entry.bytes);
    expect(Array.from(out.pixels)).toEqual(SOURCE);
    session.close();
  });

  it("keeps the original pixels of a rotated or half-transparent image", async () => {
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    const page = doc.addPage([300, 300]);
    page.drawImage(img, {
      x: 100,
      y: 100,
      width: 40,
      height: 30,
      rotate: degrees(90),
    });
    const session = sessionFor(await doc.save());
    const [rotated] = images(await session.extractImages(0, []));
    expect(Array.from((await decode(rotated.bytes)).pixels)).toEqual(SOURCE);
    session.close();

    const doc2 = await PDFDocument.create();
    const img2 = await doc2.embedPng(png);
    doc2
      .addPage([300, 300])
      .drawImage(img2, { x: 10, y: 10, width: 40, height: 30, opacity: 0.5 });
    const session2 = sessionFor(await doc2.save());
    const [faded] = images(await session2.extractImages(0, []));
    expect(faded.method).toBe("decoded-with-alpha");
    expect(Array.from((await decode(faded.bytes)).pixels)).toEqual(SOURCE);
    session2.close();
  });

  it("decodes a cropped image whole, without its transparency", async () => {
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    const page = doc.addPage([300, 300]);
    // A clip that cuts the image in half.
    page.pushOperators(
      pushGraphicsState(),
      rectangle(10, 10, 20, 30),
      clip(),
      endPath(),
    );
    page.drawImage(img, { x: 10, y: 10, width: 40, height: 30 });
    page.pushOperators(popGraphicsState());
    const session = sessionFor(await doc.save());
    const [entry] = images(await session.extractImages(0, []));
    expect(entry.method).toBe("decoded");
    const out = await decode(entry.bytes);
    // Every pixel is there, with its colour; alpha is opaque.
    const opaque = SOURCE.map((v, i) => (i % 4 === 3 ? 255 : v));
    expect(Array.from(out.pixels)).toEqual(opaque);
    session.close();
  });

  it("saves a JPEG as its original bytes, gray included", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    page.drawImage(await doc.embedJpg(jpeg), {
      x: 10,
      y: 10,
      width: 64,
      height: 32,
    });
    page.drawImage(await doc.embedJpg(grayJpeg), {
      x: 10,
      y: 100,
      width: 64,
      height: 32,
    });
    const session = sessionFor(await doc.save());
    const [color, gray] = images(await session.extractImages(0, []));
    expect(color).toMatchObject({
      method: "original-jpeg",
      mimeType: "image/jpeg",
    });
    expect(color.bytes).toEqual(jpeg);
    expect(gray).toMatchObject({
      method: "original-jpeg",
      mimeType: "image/jpeg",
    });
    expect(gray.bytes).toEqual(grayJpeg);
    session.close();
  });

  /**
   * A page drawing `jpegBytes` (16 x 8) with a soft mask whose left half has
   * alpha `leftAlpha` and right half 255. pdf-lib cannot attach a mask to a
   * JPEG, so the image XObject is written by hand.
   */
  async function maskedJpegPdf(jpegBytes: Uint8Array, leftAlpha: number) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([160, 80]);
    const mask = Uint8Array.from({ length: 16 * 8 }, (_, i) =>
      i % 16 < 8 ? leftAlpha : 255,
    );
    const image = { Type: "XObject", Subtype: "Image", Width: 16, Height: 8 };
    const smask = doc.context.register(
      doc.context.flateStream(mask, {
        ...image,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
      }),
    );
    const jpegRef = doc.context.register(
      doc.context.stream(jpegBytes, {
        ...image,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
        SMask: smask,
      }),
    );
    const name = page.node.newXObject("Im1", jpegRef);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(160, 0, 0, 80, 0, 0),
      drawObject(name),
      popGraphicsState(),
    );
    return doc.save();
  }

  it("saves a JPEG with a soft mask as a PNG with its transparency", async () => {
    const session = sessionFor(await maskedJpegPdf(jpeg, 0));
    const [entry] = images(await session.extractImages(0, []));
    expect(entry).toMatchObject({
      mimeType: "image/png",
      method: "decoded-with-alpha",
      width: 16,
      height: 8,
    });
    const out = await decode(entry.bytes);
    for (let i = 0; i < 16 * 8; i++) {
      const [r, g, b, a] = out.pixels.subarray(i * 4, i * 4 + 4);
      if (i % 16 < 8) {
        expect(a).toBe(0);
      } else {
        expect(a).toBe(255);
        // The JPEG's green (0, 160, 0), give or take JPEG rounding.
        expect(r).toBeLessThan(10);
        expect(Math.abs(g - 160)).toBeLessThan(10);
        expect(b).toBeLessThan(10);
      }
    }
    session.close();
  });

  it("keeps a JPEG whose soft mask is fully opaque as its original bytes", async () => {
    const session = sessionFor(await maskedJpegPdf(jpeg, 255));
    const [entry] = images(await session.extractImages(0, []));
    expect(entry.method).toBe("original-jpeg");
    expect(entry.bytes).toEqual(jpeg);
    session.close();
  });

  it("decodes a CMYK JPEG to an RGB PNG instead of keeping it", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawImage(await doc.embedJpg(cmykJpeg), {
      x: 10,
      y: 10,
      width: 64,
      height: 32,
    });
    const session = sessionFor(await doc.save());
    const [entry] = images(await session.extractImages(0, []));
    expect(entry.mimeType).toBe("image/png");
    expect(entry.method).not.toBe("original-jpeg");
    const out = await decode(entry.bytes);
    const [r, g, b, a] = out.pixels;
    // Reddish, as drawn (CMYK conversion is approximate).
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(100);
    expect(b).toBeLessThan(100);
    expect(a).toBe(255);
    session.close();
  });

  it("finds images inside form XObjects and reports repeats once", async () => {
    const inner = await PDFDocument.create();
    const innerImg = await inner.embedPng(png);
    inner
      .addPage([100, 100])
      .drawImage(innerImg, { x: 10, y: 10, width: 40, height: 30 });

    const doc = await PDFDocument.create();
    const [embedded] = await doc.embedPdf(await inner.save());
    const img = await doc.embedPng(png);
    const first = doc.addPage([300, 300]);
    first.drawPage(embedded, { x: 100, y: 100 });
    first.drawImage(img, { x: 10, y: 10, width: 40, height: 30 });
    doc
      .addPage([300, 300])
      .drawImage(img, { x: 10, y: 10, width: 40, height: 30 });
    const session = sessionFor(await doc.save());

    const page1 = await session.extractImages(0, []);
    // The embedded page's image and the page's own image hold the same
    // pixels (pdf-lib embeds the same PNG data), so the second is a repeat.
    expect(page1.map((e) => e.kind)).toEqual(["image", "repeat"]);
    expect(page1[1].key).toBe(page1[0].key);
    const page2 = await session.extractImages(1, [page1[0].key]);
    expect(page2).toEqual([{ kind: "repeat", key: page1[0].key }]);
    session.close();
  });

  it("handles a Chromium-printed PDF: ICC-tagged images, soft mask, crop, repeats", async () => {
    // See scripts/make-images-fixture.mjs for how the file was made.
    const session = sessionFor(fixture("images-chromium.pdf"));
    const entries = await session.extractImages(0, []);
    expect(entries.map((e) => e.kind)).toEqual([
      "image",
      "image",
      "repeat",
      "image",
    ]);
    const [mask, green, purple] = images(entries);

    // The transparent PNG: exact colours and alpha at its own 24 x 16 size.
    expect(mask).toMatchObject({
      width: 24,
      height: 16,
      method: "decoded-with-alpha",
    });
    const out = await decode(mask.bytes);
    for (let i = 0; i < 24 * 16; i++) {
      const pixel = Array.from(out.pixels.subarray(i * 4, i * 4 + 4));
      expect(pixel).toEqual(i % 24 < 12 ? [255, 0, 0, 255] : [0, 0, 255, 128]);
    }
    // Both JPEGs are kept byte for byte, the cropped one included (its
    // stream is a whole JPEG; the crop is only a clip on the page).
    expect(green.method).toBe("original-jpeg");
    expect(green.bytes).toEqual(fixture("images-chromium-green.jpg"));
    expect(purple.method).toBe("original-jpeg");
    expect(purple.bytes).toEqual(fixture("images-chromium-purple.jpg"));
    session.close();
  });

  it("returns nothing for a page without images", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]).drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
    const session = sessionFor(await doc.save());
    expect(await session.extractImages(0, [])).toEqual([]);
    session.close();
  });
});
