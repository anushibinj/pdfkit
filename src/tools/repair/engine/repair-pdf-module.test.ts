import { describe, expect, it } from "vitest";
import {
  ABI_VERSION,
  parseError,
  PdfRepairModule,
  type PdfRepairExports,
} from "./repair-pdf-module";

class FakeRepairExports implements PdfRepairExports {
  memory: WebAssembly.Memory;
  runStatus = 0;
  resultBytes = new Uint8Array([1, 2, 3]);
  reportBytes = new TextEncoder().encode(
    JSON.stringify({ pagesRecovered: 1, xrefReconstructed: true }),
  );
  freed: [number, number][] = [];
  cleared = false;

  constructor() {
    this.memory = new WebAssembly.Memory({ initial: 1 });
  }

  pdfrepair_abi_version(): number {
    return ABI_VERSION;
  }

  pdfrepair_alloc(length: number): number {
    return length > 100000 ? 0 : 16;
  }

  pdfrepair_free(pointer: number, length: number): void {
    this.freed.push([pointer, length]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pdfrepair_run(_pdf: number, _pdfLength: number): number {
    return this.runStatus;
  }

  pdfrepair_result_ptr(): number {
    // Write resultBytes into memory at offset 32
    new Uint8Array(this.memory.buffer).set(this.resultBytes, 32);
    return 32;
  }

  pdfrepair_result_len(): number {
    return this.resultBytes.length;
  }

  pdfrepair_report_ptr(): number {
    // Write reportBytes into memory at offset 128
    new Uint8Array(this.memory.buffer).set(this.reportBytes, 128);
    return 128;
  }

  pdfrepair_report_len(): number {
    return this.reportBytes.length;
  }

  pdfrepair_clear(): void {
    this.cleared = true;
  }
}

describe("PdfRepairModule", () => {
  it("repairs PDF buffer successfully", () => {
    const fake = new FakeRepairExports();
    const mod = new PdfRepairModule(fake);

    const input = new Uint8Array([37, 80, 68, 70]); // %PDF
    const outcome = mod.repair(input);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.pdf).toEqual(new Uint8Array([1, 2, 3]));
      expect(outcome.report).toContain("pagesRecovered");
    }
    expect(fake.freed.length).toBeGreaterThan(0);
    expect(fake.cleared).toBe(true);
  });

  it("handles engine error status and parses error code", () => {
    const fake = new FakeRepairExports();
    fake.runStatus = 1;
    fake.resultBytes = new TextEncoder().encode(
      JSON.stringify({ code: "invalid-pdf", message: "Corrupted PDF header" }),
    );

    const mod = new PdfRepairModule(fake);
    const outcome = mod.repair(new Uint8Array([1, 2]));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("invalid-pdf");
      expect(outcome.message).toBe("Corrupted PDF header");
    }
    expect(fake.cleared).toBe(true);
  });

  it("throws RangeError when allocation fails", () => {
    const fake = new FakeRepairExports();
    const mod = new PdfRepairModule(fake);

    // length > 100000 triggers alloc returning 0
    expect(() => mod.repair(new Uint8Array(150000))).toThrow(RangeError);
  });
});

describe("parseError", () => {
  it("parses valid error JSON", () => {
    expect(
      parseError('{"code":"encrypted","message":"Password required"}'),
    ).toEqual({
      code: "encrypted",
      message: "Password required",
    });
  });

  it("returns fallback for malformed JSON", () => {
    expect(parseError("invalid")).toEqual({
      code: "unknown",
      message: "The PDF repair engine failed.",
    });
  });
});
