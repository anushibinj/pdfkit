/**
 * The Emscripten runtime that every PDFium WebAssembly module carries
 * (`@embedpdf/pdfium`), shared by every tool that uses PDFium.
 *
 * Each tool declares its own slice of PDFium's C functions (for example
 * `PdfiumDocumentApi` here, or the editor's `PdfiumApi`); they all carry this
 * runtime as their `pdfium` field. Declaring it here instead of importing the
 * library's full type keeps tests able to fake exactly this surface.
 */

/** Emscripten runtime helpers for moving data in and out of WASM memory. */
export interface PdfiumRuntime {
  /**
   * A byte view of the whole WebAssembly memory. Emscripten replaces this
   * view when the memory grows, so it must be read again after any call that
   * may allocate; never keep a reference to it.
   */
  readonly HEAPU8: Uint8Array;
  wasmExports: {
    malloc(size: number): number;
    free(ptr: number): void;
  };
  stringToUTF16(text: string, outPtr: number, maxBytesToWrite: number): void;
  /** Read a zero-terminated UTF-16LE string. */
  UTF16ToString(ptr: number): string;
  /** Read a zero-terminated UTF-8 string. */
  UTF8ToString(ptr: number): string;
  setValue(ptr: number, value: number, type: string): void;
  /** Returns a bigint only for 64-bit integer types ("i64"). */
  getValue(ptr: number, type: string): number | bigint;
}
