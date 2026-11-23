import { describe, expect, it, vi } from "vitest";
import {
  ABI_VERSION,
  PdfRedactModule,
  parseError,
  parseSanitizeReport,
  type PdfRedactExports,
} from "./pdf-redact-module";

function fakeExports(
  behaviour: "ok" | "error" | "no-memory" | "no-memory-later" = "ok",
): PdfRedactExports {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
  let next = 16;
  let result = new Uint8Array();
  let report = new Uint8Array();
  const resultAt = 60_000;
  const reportAt = 61_000;
  const write = (bytes: Uint8Array, at: number) =>
    new Uint8Array(memory.buffer).set(bytes, at);

  return {
    memory,
    pdfredact_abi_version: () => ABI_VERSION,
    pdfredact_alloc: vi.fn((length: number) => {
      if (behaviour === "no-memory") return 0;
      if (behaviour === "no-memory-later" && next > 16) return 0;
      const ptr = next;
      next += length;
      return ptr;
    }),
    pdfredact_free: vi.fn(),
    pdfredact_run: vi.fn((pdf: number, pdfLength: number) => {
      const input = new Uint8Array(memory.buffer).slice(pdf, pdf + pdfLength);
      if (behaviour === "error") {
        result = new TextEncoder().encode(
          '{"code":"encrypted","message":"Encrypted PDF."}',
        );
        write(result, resultAt);
        return 1;
      }
      memory.grow(1);
      result = input.reverse();
      report = new TextEncoder().encode(
        '{"metadataEntriesRemoved":2,"xmpStreamsRemoved":1,"attachmentsRemoved":0,"javascriptActionsRemoved":0,"hiddenLayersRemoved":0,"bookmarksCleaned":1,"annotationsRemoved":3,"formValuesCleared":1,"objectsPruned":5}',
      );
      write(result, resultAt);
      write(report, reportAt);
      return 0;
    }),
    pdfredact_result_ptr: () => resultAt,
    pdfredact_result_len: () => result.length,
    pdfredact_report_ptr: () => reportAt,
    pdfredact_report_len: () => report.length,
    pdfredact_clear: vi.fn(),
  };
}

describe("PdfRedactModule", () => {
  it("copies inputs in, grows memory safely, copies outputs out, and frees buffers", () => {
    const exports = fakeExports();
    const mod = new PdfRedactModule(exports);
    const outcome = mod.sanitize(Uint8Array.of(1, 2, 3), Uint8Array.of(9));
    expect(outcome).toEqual({
      ok: true,
      pdf: Uint8Array.of(3, 2, 1),
      report: {
        metadataEntriesRemoved: 2,
        xmpStreamsRemoved: 1,
        attachmentsRemoved: 0,
        javascriptActionsRemoved: 0,
        hiddenLayersRemoved: 0,
        bookmarksCleaned: 1,
        annotationsRemoved: 3,
        formValuesCleared: 1,
        objectsPruned: 5,
      },
    });
    expect(exports.pdfredact_free).toHaveBeenCalledTimes(2);
    expect(exports.pdfredact_clear).toHaveBeenCalledTimes(1);
  });

  it("returns structured errors and throws RangeError on OOM", () => {
    const errMod = new PdfRedactModule(fakeExports("error"));
    expect(errMod.sanitize(Uint8Array.of(1), Uint8Array.of(1))).toEqual({
      ok: false,
      code: "encrypted",
      message: "Encrypted PDF.",
    });

    const oom = fakeExports("no-memory");
    expect(() =>
      new PdfRedactModule(oom).sanitize(Uint8Array.of(1), Uint8Array.of(1)),
    ).toThrow(RangeError);
    expect(oom.pdfredact_free).not.toHaveBeenCalled();

    const later = fakeExports("no-memory-later");
    expect(() =>
      new PdfRedactModule(later).sanitize(
        Uint8Array.of(1, 2),
        Uint8Array.of(1),
      ),
    ).toThrow(RangeError);
    expect(later.pdfredact_free).toHaveBeenCalledWith(16, 2);
  });

  it("loads WASM and checks ABI version", async () => {
    const abiWasm = (v: number) =>
      Uint8Array.of(
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
        0x19,
        0x01,
        0x15,
        ...new TextEncoder().encode("pdfredact_abi_version"),
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

    const mod = await PdfRedactModule.load(
      "/wasm/pdf-redact.wasm",
      async () => abiWasm(ABI_VERSION),
    );
    expect(mod).toBeInstanceOf(PdfRedactModule);
    await expect(
      PdfRedactModule.load("/wasm/pdf-redact.wasm", async () =>
        abiWasm(ABI_VERSION + 1),
      ),
    ).rejects.toThrow("expected 1");
  });

  it("parses errors and reports with safe fallbacks", () => {
    expect(parseError('{"code":"encrypted","message":"Locked"}')).toEqual({
      code: "encrypted",
      message: "Locked",
    });
    expect(parseError("not-json").code).toBe("unknown");
    expect(parseSanitizeReport("not-json").objectsPruned).toBe(0);
  });
});
