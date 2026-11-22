import { describe, expect, it } from "vitest";
import { PdfiumDocument } from "./document";
import { saveDocumentCopy } from "./save";
import { fakeDocumentPdfium } from "./test-utils/fake-api";
import { WasmHeap } from "./wasm-heap";

describe("saveDocumentCopy", () => {
  it("copies the writer's bytes and always closes the writer", () => {
    const { api, runtime } = fakeDocumentPdfium();
    const heap = new WasmHeap(runtime);
    const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
    api.PDFiumExt_GetFileWriterSize.mockReturnValue(3);
    api.PDFiumExt_GetFileWriterData.mockImplementation((_w, ptr) => {
      runtime.HEAPU8.set([37, 80, 68], ptr);
      return 3;
    });
    expect(Array.from(saveDocumentCopy(api, heap, doc))).toEqual([37, 80, 68]);
    expect(api.PDFiumExt_SaveAsCopy).toHaveBeenCalledWith(
      doc.handle,
      expect.any(Number),
    );
    api.PDFiumExt_SaveAsCopy.mockReturnValue(0);
    expect(() => saveDocumentCopy(api, heap, doc)).toThrow("could not save");
    expect(api.PDFiumExt_CloseFileWriter).toHaveBeenCalledTimes(2);
    api.PDFiumExt_OpenFileWriter.mockReturnValue(0);
    expect(() => saveDocumentCopy(api, heap, doc)).toThrow(RangeError);
    doc.close();
    expect(runtime.leaks()).toEqual([]);
  });
});
