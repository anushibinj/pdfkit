import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { serializeCompressPlan } from "../core/options";
import {
  ABI_VERSION,
  PdfCompressModule,
  parseCompressError,
  type PdfCompressExports,
} from "./compress-pdf-module";

function makeFakeExports(overrides: Partial<PdfCompressExports> = {}): PdfCompressExports {
  const memory = new WebAssembly.Memory({ initial: 2 });
  let nextPtr = 1024;
  let resultPtr = 0;
  let resultLen = 0;
  let reportPtr = 0;
  let reportLen = 0;

  return {
    memory,
    pdfcompress_abi_version: () => ABI_VERSION,
    pdfcompress_alloc: (len) => {
      const p = nextPtr;
      nextPtr += Math.max(1, len);
      return p;
    },
    pdfcompress_free: vi.fn(),
    pdfcompress_run: () => {
      const out = new TextEncoder().encode("%PDF-1.5 compressed");
      const rep = new TextEncoder().encode('{"originalBytes":100,"compressedBytes":50}');
      resultPtr = nextPtr;
      resultLen = out.length;
      new Uint8Array(memory.buffer).set(out, resultPtr);
      nextPtr += out.length;
      reportPtr = nextPtr;
      reportLen = rep.length;
      new Uint8Array(memory.buffer).set(rep, reportPtr);
      nextPtr += rep.length;
      return 0;
    },
    pdfcompress_encode_jpeg: () => {
      const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      resultPtr = nextPtr;
      resultLen = jpg.length;
      new Uint8Array(memory.buffer).set(jpg, resultPtr);
      nextPtr += jpg.length;
      return 0;
    },
    pdfcompress_result_ptr: () => resultPtr,
    pdfcompress_result_len: () => resultLen,
    pdfcompress_report_ptr: () => reportPtr,
    pdfcompress_report_len: () => reportLen,
    pdfcompress_clear: vi.fn(),
    ...overrides,
  };
}

describe("PdfCompressModule", () => {
  it("parses error JSON safely", () => {
    expect(parseCompressError('{"code":"encrypted","message":"Locked"}')).toEqual({
      code: "encrypted",
      message: "Locked",
    });
    expect(parseCompressError("bad json")).toEqual({
      code: "unknown",
      message: "The PDF compression engine failed.",
    });
  });

  it("compresses PDF and frees buffers on success", () => {
    const exports = makeFakeExports();
    const mod = new PdfCompressModule(exports);
    const outcome = mod.compress(
      new Uint8Array([1, 2, 3]),
      serializeCompressPlan({
        lossless: true,
        targetDpi: 0,
        quality: 1,
        grayscale: false,
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(new TextDecoder().decode(outcome.pdf)).toBe("%PDF-1.5 compressed");
      expect(outcome.report).toContain("originalBytes");
    }
    expect(exports.pdfcompress_free).toHaveBeenCalledTimes(2);
    expect(exports.pdfcompress_clear).toHaveBeenCalledTimes(1);
  });

  it("encodes RGBA pixels to JPEG via FFI", () => {
    const exports = makeFakeExports();
    const mod = new PdfCompressModule(exports);
    const jpeg = mod.encodeJpeg(new Uint8Array(4 * 4 * 4), 4, 4, 4, 4, 0.75, false);
    expect(Array.from(jpeg)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("executes real pdf_compress.wasm end-to-end when built", async () => {
    const wasmUrl = new URL(
      "../../../../crates/pdf-compress/dist/pdf_compress.wasm",
      import.meta.url,
    );
    let wasmBytes: Buffer;
    try {
      wasmBytes = readFileSync(wasmUrl);
    } catch {
      return; // Skip only if binary hasn't been compiled yet
    }

    const mod = await PdfCompressModule.load(
      "pdf-compress.wasm",
      async () =>
        wasmBytes.buffer.slice(
          wasmBytes.byteOffset,
          wasmBytes.byteOffset + wasmBytes.byteLength,
        ) as ArrayBuffer,
    );
    const plain = new Uint8Array(
      readFileSync(new URL("../../../../fixtures/plain.pdf", import.meta.url)),
    );
    const outcome = mod.compress(plain);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.pdf.length).toBeLessThanOrEqual(plain.length);
    }
  });
});
