import type { PdfiumDocument } from "./document";
import type { PdfiumRuntime } from "./runtime";
import type { WasmHeap } from "./wasm-heap";

/**
 * The PDFium functions {@link saveDocumentCopy} calls: EmbedPDF's "file
 * writer" extension. Kept apart from `PdfiumDocumentApi` so tools that only
 * read and render PDFs do not depend on saving.
 */
export interface PdfiumSaveApi {
  pdfium: PdfiumRuntime;

  PDFiumExt_OpenFileWriter(): number;
  PDFiumExt_SaveAsCopy(doc: number, writer: number): number;
  PDFiumExt_GetFileWriterSize(writer: number): number;
  PDFiumExt_GetFileWriterData(
    writer: number,
    dataPtr: number,
    size: number,
  ): number;
  PDFiumExt_CloseFileWriter(writer: number): void;
}

/**
 * Serialise a document (with every change made so far) to PDF bytes.
 *
 * The EmbedPDF extension collects PDFium's output in a growable buffer
 * ("file writer"): save into it, ask its size, copy that many bytes into a
 * block we own, then copy them out to JavaScript. The writer is closed and
 * the block freed whatever happens. An encrypted document is written
 * encrypted again with its original security handler, so a file that
 * needed a password still needs it.
 *
 * @param api The PDFium module.
 * @param heap Memory helper for that module.
 * @param doc The open document to save.
 * @returns The PDF file's bytes.
 * @throws When PDFium reports a failure.
 */
export function saveDocumentCopy(
  api: PdfiumSaveApi,
  heap: WasmHeap,
  doc: PdfiumDocument,
): Uint8Array {
  const writer = api.PDFiumExt_OpenFileWriter();
  if (!writer) throw new RangeError("out of memory: could not start saving");
  try {
    if (!api.PDFiumExt_SaveAsCopy(doc.handle, writer)) {
      throw new Error("PDFium could not save the document");
    }
    const size = api.PDFiumExt_GetFileWriterSize(writer);
    return heap.using(heap.alloc(size), (ptr) => {
      api.PDFiumExt_GetFileWriterData(writer, ptr, size);
      return heap.copyOut(ptr, size);
    });
  } finally {
    api.PDFiumExt_CloseFileWriter(writer);
  }
}
