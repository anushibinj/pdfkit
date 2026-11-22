/**
 * Test-only helpers that run the real PDFium WebAssembly build in Node.
 * Node only (uses fs).
 */
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Instantiate PDFium from the npm package's binary, the same file the site
 * serves from /wasm/.
 *
 * @returns The initialised module (narrow it to a tool's API slice).
 */
export async function loadNodePdfiumModule(): Promise<WrappedPdfiumModule> {
  const require = createRequire(import.meta.url);
  const wasmBinary = readFileSync(
    require.resolve("@embedpdf/pdfium/pdfium.wasm"),
  );
  const full = await init({ wasmBinary } as never);
  full.PDFiumExt_Init();
  return full;
}

/**
 * Read one pixel of an RGBA bitmap.
 *
 * @param img Pixels and width.
 * @param x Column (rounded).
 * @param y Row (rounded).
 * @returns `[r, g, b]`.
 */
export function pixelAt(
  img: { width: number; pixels: Uint8Array },
  x: number,
  y: number,
): [number, number, number] {
  const o = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]];
}

/**
 * Copy a Node Buffer or Uint8Array into a standalone ArrayBuffer.
 *
 * @param bytes Any byte view.
 * @returns An ArrayBuffer of exactly those bytes.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
