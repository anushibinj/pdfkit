/**
 * Paint RGBA pixels onto a canvas, resizing it to match.
 *
 * Setting `width`/`height` also clears the canvas, so no old content
 * survives. Without a 2D context (jsdom, or a browser that refuses one for
 * memory reasons) nothing is drawn.
 *
 * @param canvas The target canvas.
 * @param width Bitmap width in pixels.
 * @param height Bitmap height in pixels.
 * @param pixels RGBA data, width * height * 4 bytes.
 */
export function drawPixels(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixels: ArrayBuffer,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
}
