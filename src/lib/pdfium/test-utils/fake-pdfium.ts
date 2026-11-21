/**
 * Test doubles for the shared PDFium layer. Unit tests use them to check
 * call order and clean-up; real behaviour is covered by integration tests
 * that run the actual WebAssembly build.
 */
import { vi, type Mock } from "vitest";
import type { PdfiumDocumentApi, PdfiumRuntime } from "../pdfium-api";

/**
 * A runtime with a bump allocator over a real byte array. Memory "grows" on
 * every allocation by swapping `HEAPU8` for a new, larger view, the way
 * Emscripten does, so code that holds on to an old view is caught.
 */
export class FakeRuntime implements PdfiumRuntime {
  HEAPU8 = new Uint8Array(64);
  private next = 8;
  readonly freed: number[] = [];
  readonly allocated: number[] = [];
  /** Size requested for each allocation, by address. */
  readonly sizes = new Map<number, number>();
  /** Every malloc and free in order, e.g. "free:12". */
  readonly log: string[] = [];
  /** Set to make the next allocations fail (malloc returns 0). */
  failAlloc = false;
  readonly floats = new Map<number, number>();
  readonly strings = new Map<number, string>();

  wasmExports = {
    malloc: (size: number) => {
      if (this.failAlloc) return 0;
      const ptr = this.next;
      this.next += size;
      const grown = new Uint8Array(this.next + 64);
      grown.set(this.HEAPU8);
      this.HEAPU8 = grown;
      this.allocated.push(ptr);
      this.sizes.set(ptr, size);
      this.log.push(`malloc:${ptr}`);
      return ptr;
    },
    free: (ptr: number) => {
      this.freed.push(ptr);
      this.log.push(`free:${ptr}`);
    },
  };

  stringToUTF16 = (text: string, ptr: number) => {
    this.strings.set(ptr, text);
    return text.length * 2;
  };

  /** Decodes real bytes from `HEAPU8` (UTF-16LE up to a 0 code unit). */
  UTF16ToString = (ptr: number) => {
    let text = "";
    for (let o = ptr; o + 1 < this.HEAPU8.length; o += 2) {
      const unit = this.HEAPU8[o] | (this.HEAPU8[o + 1] << 8);
      if (unit === 0) break;
      text += String.fromCharCode(unit);
    }
    return text;
  };

  /** Decodes real bytes from `HEAPU8` (UTF-8 up to a 0 byte). */
  UTF8ToString = (ptr: number) => {
    const end = this.HEAPU8.indexOf(0, ptr);
    return new TextDecoder().decode(
      this.HEAPU8.subarray(ptr, end < 0 ? undefined : end),
    );
  };

  /**
   * Write a string the way PDFium would, for `UTF16ToString` to read.
   *
   * @param ptr Where to write.
   * @param text The text, written as UTF-16LE plus a 0 terminator.
   */
  writeUtf16(ptr: number, text: string): void {
    for (let i = 0; i <= text.length; i++) {
      const unit = i < text.length ? text.charCodeAt(i) : 0;
      this.HEAPU8[ptr + i * 2] = unit & 0xff;
      this.HEAPU8[ptr + i * 2 + 1] = unit >> 8;
    }
  }

  setValue = (ptr: number, value: number) => {
    this.floats.set(ptr, value);
  };

  getValue = (ptr: number) => this.floats.get(ptr) ?? 0;

  /** @returns Allocations that were never freed. */
  leaks(): number[] {
    return this.allocated.filter((p) => !this.freed.includes(p));
  }
}

/** The shared document functions, without the runtime. */
export type DocumentFunctions = Omit<PdfiumDocumentApi, "pdfium">;

/**
 * Harmless success values for every shared document function: handles are
 * the next number from `nextHandle`, booleans are true, sizes are 0.
 *
 * Tool-specific fakes spread these into their own defaults, so a function
 * declared once in `PdfiumDocumentApi` is also faked in one place only.
 *
 * @param nextHandle Returns a fresh, non-zero handle on each call.
 * @returns One implementation per shared function.
 */
export function documentApiDefaults(nextHandle: () => number): {
  [K in keyof DocumentFunctions]: DocumentFunctions[K];
} {
  const ok = () => true;
  const none = () => {};
  return {
    FPDF_GetLastError: () => 0,
    FPDF_LoadMemDocument: nextHandle,
    FPDF_CloseDocument: none,
    FPDF_GetPageCount: () => 1,
    FPDF_LoadPage: nextHandle,
    FPDF_ClosePage: none,
    FPDF_GetPageBoundingBox: ok,
    FPDF_RenderPageBitmap: none,
    FPDFPage_GetRotation: () => 0,
    FPDFBitmap_Create: nextHandle,
    FPDFBitmap_FillRect: ok,
    FPDFBitmap_GetBuffer: () => 0,
    FPDFBitmap_GetStride: () => 0,
    FPDFBitmap_Destroy: none,
    PDFiumExt_OpenFileWriter: nextHandle,
    PDFiumExt_SaveAsCopy: () => 1,
    PDFiumExt_GetFileWriterSize: () => 0,
    PDFiumExt_GetFileWriterData: () => 0,
    PDFiumExt_CloseFileWriter: none,
  };
}

/**
 * Wrap each implementation in a typed `vi.fn`, so tests can both override
 * it (`mockReturnValue`, `mockImplementation`) and assert on its calls.
 *
 * @param impls Function implementations by name.
 * @returns The same names, each mapped to a mock of its implementation.
 */
export function mockAll<T extends Record<string, (...args: never[]) => unknown>>(
  impls: T,
): { [K in keyof T]: Mock<T[K]> } {
  return Object.fromEntries(
    Object.entries(impls).map(([name, impl]) => [name, vi.fn(impl)]),
  ) as { [K in keyof T]: Mock<T[K]> };
}

/** Each shared document function as a typed `vi.fn` mock. */
export type MockedDocumentApi = {
  [K in keyof DocumentFunctions]: Mock<DocumentFunctions[K]>;
} & {
  pdfium: FakeRuntime;
};

/**
 * A `PdfiumDocumentApi` where every function is a mock returning a
 * harmless success value (see {@link documentApiDefaults}).
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakeDocumentApi(runtime = new FakeRuntime()): {
  api: MockedDocumentApi;
  runtime: FakeRuntime;
} {
  let handle = 100;
  const api = {
    ...mockAll(documentApiDefaults(() => ++handle)),
    pdfium: runtime,
  };
  return { api, runtime };
}
