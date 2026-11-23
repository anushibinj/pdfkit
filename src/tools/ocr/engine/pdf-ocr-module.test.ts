// @vitest-environment node
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ABI_VERSION,
  parseOcrWasmError,
  PdfOcrModule,
  type PdfOcrExports,
} from "./pdf-ocr-module";

describe("parseOcrWasmError", () => {
  it("extracts code and message or falls back cleanly", () => {
    expect(
      parseOcrWasmError('{"code":"invalid-gzip","message":"Bad gzip"}'),
    ).toEqual({ code: "invalid-gzip", message: "Bad gzip" });
    expect(parseOcrWasmError("not json")).toEqual({
      code: "unknown",
      message: "The PDF OCR helper engine failed.",
    });
  });
});

describe("PdfOcrModule (real pdf_ocr.wasm)", () => {
  it("loads pdf_ocr.wasm, gunzips, encodes BMP, builds text layer, and normalizes overlay", async () => {
    const wasmBytes = readFileSync(
      new URL(
        "../../../../crates/pdf-ocr/dist/pdf_ocr.wasm",
        import.meta.url,
      ),
    );
    const mod = await PdfOcrModule.load("pdf-ocr.wasm", async () =>
      wasmBytes.buffer.slice(
        wasmBytes.byteOffset,
        wasmBytes.byteOffset + wasmBytes.byteLength,
      ),
    );

    // 1. Gunzip
    const raw = new TextEncoder().encode("sample traineddata content");
    const gz = new Uint8Array(gzipSync(raw));
    expect(mod.gunzip(gz)).toEqual(raw);

    // 2. BMP encoding
    const rgba = new Uint8Array(4 * 4 * 4).fill(200);
    const bmp = mod.preprocessBmp(rgba, 4, 4, 300, 300, false);
    expect(bmp[0]).toBe(0x42);
    expect(bmp[1]).toBe(0x4d);

    // 3. Text layer + overlay normalization
    const tsv =
      "5\t1\t1\t1\t1\t1\t10\t20\t80\t24\t95\tनमस्ते\n";
    const layer = mod.buildTextLayer(tsv, 300, 400, 100, 100);
    expect(new TextDecoder().decode(layer.slice(0, 5))).toBe("%PDF-");

    const normalized = mod.normalizeOverlay(layer, 612, 792);
    expect(new TextDecoder().decode(normalized.slice(0, 5))).toBe("%PDF-");
  });

  it("rejects mismatched ABI versions", () => {
    const fakeExports: PdfOcrExports = {
      memory: new WebAssembly.Memory({ initial: 1 }),
      pdfocr_abi_version: () => ABI_VERSION + 1,
      pdfocr_alloc: () => 0,
      pdfocr_free: () => {},
      pdfocr_gunzip: () => 0,
      pdfocr_preprocess_bmp: () => 0,
      pdfocr_normalize_overlay: () => 0,
      pdfocr_build_text_layer: () => 0,
      pdfocr_result_ptr: () => 0,
      pdfocr_result_len: () => 0,
      pdfocr_clear: () => {},
    };
    expect(fakeExports.pdfocr_abi_version()).not.toBe(ABI_VERSION);
  });
});
