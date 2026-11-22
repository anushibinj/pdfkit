import { describe, expect, it, vi } from "vitest";
import {
  ABI_VERSION,
  PdfCropModule,
  parseError,
  type PdfCropExports,
} from "./pdf-crop-module";

/**
 * A fake module: a bump allocator over a growable memory. `run` echoes the
 * reversed input as the result, or fails with an error JSON.
 */
function fakeExports(
  behaviour: "ok" | "error" | "no-memory" | "no-memory-later" = "ok",
) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
  let next = 16;
  let result = new Uint8Array();
  let report = new Uint8Array();
  const resultAt = 60_000;
  const reportAt = 61_000;
  const write = (bytes: Uint8Array, at: number) =>
    new Uint8Array(memory.buffer).set(bytes, at);
  const exports: PdfCropExports = {
    memory,
    pdfcrop_abi_version: () => ABI_VERSION,
    pdfcrop_alloc: vi.fn((length: number) => {
      if (behaviour === "no-memory") return 0;
      if (behaviour === "no-memory-later" && next > 16) return 0;
      const ptr = next;
      next += length;
      return ptr;
    }),
    pdfcrop_free: vi.fn(),
    pdfcrop_run: vi.fn((pdf: number, pdfLength: number) => {
      const input = new Uint8Array(memory.buffer).slice(pdf, pdf + pdfLength);
      if (behaviour === "error") {
        result = new TextEncoder().encode(
          '{"code":"encrypted","message":"No."}',
        );
        write(result, resultAt);
        return 1;
      }
      // Growing replaces memory.buffer: the reader must not keep old views.
      memory.grow(1);
      result = input.reverse();
      report = new TextEncoder().encode('{"pagesCropped":1}');
      write(result, resultAt);
      write(report, reportAt);
      return 0;
    }),
    pdfcrop_result_ptr: () => resultAt,
    pdfcrop_result_len: () => result.length,
    pdfcrop_report_ptr: () => reportAt,
    pdfcrop_report_len: () => report.length,
    pdfcrop_clear: vi.fn(),
  };
  return exports;
}

describe("PdfCropModule.crop", () => {
  it("copies the input in, runs, copies the result out and frees everything", () => {
    const exports = fakeExports();
    const cropper = new PdfCropModule(exports);
    const outcome = cropper.crop(Uint8Array.of(1, 2, 3), Uint8Array.of(9));
    expect(outcome).toEqual({
      ok: true,
      pdf: Uint8Array.of(3, 2, 1),
      report: '{"pagesCropped":1}',
    });
    expect(exports.pdfcrop_free).toHaveBeenCalledTimes(2);
    expect(exports.pdfcrop_clear).toHaveBeenCalledTimes(1);
  });

  it("returns the module's error", () => {
    const cropper = new PdfCropModule(fakeExports("error"));
    expect(cropper.crop(Uint8Array.of(1), Uint8Array.of(1))).toEqual({
      ok: false,
      code: "encrypted",
      message: "No.",
    });
  });

  it("reports running out of memory as a RangeError and frees what it got", () => {
    const empty = fakeExports("no-memory");
    expect(() =>
      new PdfCropModule(empty).crop(Uint8Array.of(1), Uint8Array.of(1)),
    ).toThrow(RangeError);
    // Nothing was allocated, so nothing is freed.
    expect(empty.pdfcrop_free).not.toHaveBeenCalled();
    // The file fits but the plan does not: the file's block is released.
    const later = fakeExports("no-memory-later");
    expect(() =>
      new PdfCropModule(later).crop(Uint8Array.of(1, 2), Uint8Array.of(1)),
    ).toThrow(RangeError);
    expect(later.pdfcrop_free).toHaveBeenCalledWith(16, 2);
    expect(later.pdfcrop_run).not.toHaveBeenCalled();
  });
});

describe("PdfCropModule.load", () => {
  /** The smallest module exporting `pdfcrop_abi_version` returning `v`. */
  function abiModule(v: number): ArrayBuffer {
    // (module (func (export "pdfcrop_abi_version") (result i32) i32.const v))
    return Uint8Array.of(
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x05,
      0x01,
      0x60,
      0x00,
      0x01,
      0x7f,
      0x03,
      0x02,
      0x01,
      0x00,
      0x07,
      0x17,
      0x01,
      0x13,
      ...new TextEncoder().encode("pdfcrop_abi_version"),
      0x00,
      0x00,
      0x0a,
      0x06,
      0x01,
      0x04,
      0x00,
      0x41,
      v,
      0x0b,
    ).buffer;
  }

  it("instantiates the fetched binary and checks its interface version", async () => {
    const loadBytes = vi.fn(async () => abiModule(ABI_VERSION));
    const cropper = await PdfCropModule.load("/wasm/pdf-crop.wasm", loadBytes);
    expect(cropper).toBeInstanceOf(PdfCropModule);
    expect(loadBytes).toHaveBeenCalledWith("/wasm/pdf-crop.wasm");
  });

  it("refuses a binary of another interface version", async () => {
    await expect(
      PdfCropModule.load("/x.wasm", async () => abiModule(ABI_VERSION + 1)),
    ).rejects.toThrow("expected 1");
  });
});

describe("parseError", () => {
  it("reads the code and message", () => {
    expect(parseError('{"code":"empty-crop","message":"m"}')).toEqual({
      code: "empty-crop",
      message: "m",
    });
  });

  it("falls back for anything else", () => {
    for (const text of ["", "null", "[]", '{"code":1}']) {
      expect(parseError(text).code).toBe("unknown");
    }
  });
});
