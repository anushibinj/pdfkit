import { deflateZlib } from "@/lib/png/deflate";
import { encodePng, type RgbaImage } from "@/lib/png/png-encoder";
import type { ImageEncoders } from "../engine/images-session";

/** The part of `OffscreenCanvas` the JPEG encoder uses. */
export interface CanvasLike {
  getContext(type: "2d"): {
    putImageData(data: ImageData, dx: number, dy: number): void;
  } | null;
  convertToBlob(options: { type: string; quality: number }): Promise<Blob>;
}

/** Creates a canvas of a given size (an `OffscreenCanvas` in the worker). */
export type CanvasFactory = (width: number, height: number) => CanvasLike;

/** Wraps RGBA pixels as `ImageData` (the constructor, in the worker). */
export type ImageDataFactory = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
) => ImageData;

/**
 * The real factories, when the platform has them. Workers have
 * `OffscreenCanvas` in every current browser (Safari since 16.4); without
 * it JPEG output is not available.
 *
 * @returns The factories, or null when the platform lacks them.
 */
export function platformCanvas(): {
  createCanvas: CanvasFactory;
  createImageData: ImageDataFactory;
} | null {
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof ImageData === "undefined"
  ) {
    return null;
  }
  return {
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    createImageData: (pixels, width, height) =>
      new ImageData(pixels, width, height),
  };
}

/**
 * Build a JPEG encoder on a 2D canvas.
 *
 * The browser's own encoder is used: draw the pixels with `putImageData`
 * (an exact copy, no scaling or blending) and ask for a JPEG blob. A canvas
 * stores premultiplied alpha, but rendered pages are opaque, so nothing is
 * lost on the way. The blob's type is checked because a browser that cannot
 * encode a type silently returns PNG instead.
 *
 * @param canvas The canvas factories, or null if the platform has none.
 * @returns An encoder taking pixels and a quality from 0 to 1.
 */
export function createJpegEncoder(
  canvas: ReturnType<typeof platformCanvas>,
): ImageEncoders["jpeg"] {
  return async (image: RgbaImage, quality: number) => {
    if (!canvas) {
      throw new Error(
        "This browser cannot create JPEG files in the background. Choose PNG, or update the browser.",
      );
    }
    const target = canvas.createCanvas(image.width, image.height);
    const context = target.getContext("2d");
    if (!context) throw new Error("Could not create a canvas to encode JPEG.");
    // ImageData wants a Uint8ClampedArray over the same bytes (no copy).
    const view = new Uint8ClampedArray(
      image.pixels.buffer as ArrayBuffer,
      image.pixels.byteOffset,
      image.pixels.byteLength,
    );
    context.putImageData(
      canvas.createImageData(view, image.width, image.height),
      0,
      0,
    );
    const blob = await target.convertToBlob({ type: "image/jpeg", quality });
    if (blob.type !== "image/jpeg") {
      throw new Error(
        "This browser could not encode JPEG. Choose PNG instead.",
      );
    }
    return new Uint8Array(await blob.arrayBuffer());
  };
}

/**
 * The encoders the worker uses: the lossless PNG encoder with the
 * platform's zlib, and JPEG on a canvas.
 *
 * @param canvas The canvas factories (defaults to the platform's).
 * @returns PNG and JPEG encoders.
 */
export function createEncoders(
  canvas: ReturnType<typeof platformCanvas> = platformCanvas(),
): ImageEncoders {
  return {
    png: (image) => encodePng(image, deflateZlib),
    jpeg: createJpegEncoder(canvas),
  };
}
