/**
 * Test-only helpers that run the real PDFium WebAssembly build in Node.
 * Node only (uses fs); import them from tests marked
 * `// @vitest-environment node`.
 */
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Instantiate PDFium from the npm package's binary.
 *
 * The browser build fetches `pdfium.wasm` by URL; in Node the binary is read
 * from disk and handed over as `wasmBinary` instead.
 *
 * @returns The full, initialised module (narrow it to a tool's interface).
 */
export async function loadNodePdfiumModule(): Promise<WrappedPdfiumModule> {
  const require = createRequire(import.meta.url);
  const wasmBinary = readFileSync(
    require.resolve("@embedpdf/pdfium/pdfium.wasm"),
  );
  const pdfium = await init({ wasmBinary } as never);
  pdfium.PDFiumExt_Init();
  return pdfium;
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
