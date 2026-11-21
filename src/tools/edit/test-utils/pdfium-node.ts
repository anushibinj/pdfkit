/**
 * Test-only helpers that run the real PDFium WebAssembly build in Node and
 * build small fixture files. Node only (uses fs and zlib).
 */
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { PdfiumApi } from "../engine/pdfium-api";

/** The full PDFium module (for inspection helpers the editor never needs). */
export type FullPdfium = WrappedPdfiumModule;

/**
 * Instantiate PDFium from the npm package's binary.
 *
 * @returns The module, usable both as the editor's narrow API and in full.
 */
export async function loadNodePdfium(): Promise<{
  api: PdfiumApi;
  full: FullPdfium;
}> {
  const require = createRequire(import.meta.url);
  const wasmBinary = readFileSync(
    require.resolve("@embedpdf/pdfium/pdfium.wasm"),
  );
  const full = await init({ wasmBinary } as never);
  full.PDFiumExt_Init();
  return { api: full as unknown as PdfiumApi, full };
}

/**
 * Extract every page's text from a PDF with PDFium.
 *
 * @param full The PDFium module.
 * @param bytes The PDF file.
 * @param password Its password, if any.
 * @returns One string per page.
 */
export function extractText(
  full: FullPdfium,
  bytes: Uint8Array,
  password = "",
): string[] {
  const { pdfium } = full;
  const ptr = pdfium.wasmExports.malloc(bytes.length);
  pdfium.HEAPU8.set(bytes, ptr);
  const doc = full.FPDF_LoadMemDocument(ptr, bytes.length, password);
  if (!doc) throw new Error(`load failed: ${full.FPDF_GetLastError()}`);
  const pages: string[] = [];
  for (let i = 0; i < full.FPDF_GetPageCount(doc); i++) {
    const page = full.FPDF_LoadPage(doc, i);
    const text = full.FPDFText_LoadPage(page);
    const n = full.FPDFText_CountChars(text);
    const buf = pdfium.wasmExports.malloc((n + 1) * 2);
    full.FPDFText_GetText(text, 0, n, buf);
    // With no characters PDFium writes nothing, not even the terminator, so
    // the (uninitialised) buffer must not be decoded.
    pages.push(n > 0 ? pdfium.UTF16ToString(buf) : "");
    pdfium.wasmExports.free(buf);
    full.FPDFText_ClosePage(text);
    full.FPDF_ClosePage(page);
  }
  full.FPDF_CloseDocument(doc);
  pdfium.wasmExports.free(ptr);
  return pages;
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
