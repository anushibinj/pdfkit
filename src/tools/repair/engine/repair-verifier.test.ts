import { describe, expect, it } from "vitest";
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { fakePdfiumCore } from "@/lib/pdfium/test-utils/fake-pdfium";
import { RepairVerifier } from "./repair-verifier";

describe("RepairVerifier", () => {
  it("rejects empty byte input", () => {
    const { api, runtime } = fakePdfiumCore();
    const verifier = new RepairVerifier(api);

    const result = verifier.verify(new Uint8Array(0));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("empty");
    }
    expect(runtime.leaks()).toEqual([]);
  });

  it("identifies password protected documents", () => {
    const { api, runtime } = fakePdfiumCore();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.PASSWORD);

    const verifier = new RepairVerifier(api);
    const result = verifier.verify(new Uint8Array([1, 2, 3, 4]));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("password-required");
    }
    expect(runtime.leaks()).toEqual([]);
  });

  it("handles corrupted documents that fail to load", () => {
    const { api, runtime } = fakePdfiumCore();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.FORMAT);

    const verifier = new RepairVerifier(api);
    const result = verifier.verify(new Uint8Array([1, 2, 3]));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("corrupt");
    }
    expect(runtime.leaks()).toEqual([]);
  });

  it("fails verification if document reports 0 pages", () => {
    const { api, runtime } = fakePdfiumCore();
    api.FPDF_GetPageCount.mockReturnValue(0);

    const verifier = new RepairVerifier(api);
    const result = verifier.verify(new Uint8Array([1, 2, 3]));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("corrupt");
      expect(result.message).toContain("0 pages");
    }
    expect(api.FPDF_CloseDocument).toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });

  it("fails verification if first page cannot be opened", () => {
    const { api, runtime } = fakePdfiumCore();
    api.FPDF_GetPageCount.mockReturnValue(1);
    api.FPDF_LoadPage.mockReturnValue(0); // page loading failure

    const verifier = new RepairVerifier(api);
    const result = verifier.verify(new Uint8Array([1, 2, 3]));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("corrupt");
      expect(result.message).toContain("Failed to load initial page");
    }
    expect(api.FPDF_CloseDocument).toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });

  it("verifies valid documents and returns page count", () => {
    const { api, runtime } = fakePdfiumCore();
    api.FPDF_GetPageCount.mockReturnValue(5);

    const verifier = new RepairVerifier(api);
    const result = verifier.verify(new Uint8Array([1, 2, 3]));

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.pageCount).toBe(5);
      expect(result.normalizedBytes).toBeUndefined();
    }
    expect(api.FPDF_ClosePage).toHaveBeenCalled();
    expect(api.FPDF_CloseDocument).toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });

  it("reserializes document bytes when requested", () => {
    const { api, runtime } = fakePdfiumCore();
    api.FPDF_GetPageCount.mockReturnValue(2);
    api.PDFiumExt_GetFileWriterSize.mockReturnValue(4);
    api.PDFiumExt_GetFileWriterData.mockImplementation(
      (_writer: number, bufPtr: number, size: number) => {
        runtime.HEAPU8.set(new Uint8Array([10, 20, 30, 40]), bufPtr);
        return size;
      },
    );

    const verifier = new RepairVerifier(api);
    const result = verifier.verify(new Uint8Array([1, 2, 3]), "", true);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.pageCount).toBe(2);
      expect(result.normalizedBytes).toEqual(new Uint8Array([10, 20, 30, 40]));
    }
    expect(api.PDFiumExt_CloseFileWriter).toHaveBeenCalled();
    expect(api.FPDF_CloseDocument).toHaveBeenCalled();
    expect(runtime.leaks()).toEqual([]);
  });
});
