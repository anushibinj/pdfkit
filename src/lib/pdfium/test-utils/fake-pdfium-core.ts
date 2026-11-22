/**
 * Test doubles for the core of the PDFium module. Unit tests use them to
 * check call order and clean-up; real behaviour is covered by integration
 * tests that run the actual WebAssembly build. Tools that use more of
 * PDFium extend the defaults (see the editor's `fake-pdfium.ts`).
 */
import { vi, type Mock } from "vitest";
import type { PdfiumCoreApi, PdfiumRuntime } from "../pdfium-core-api";

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

/** An API's functions, without the runtime. */
export type PdfiumFunctions<Api> = Omit<Api, "pdfium">;

/** Each function of `Api` as a typed `vi.fn` mock, plus the fake runtime. */
export type MockedApi<Api> = {
  [K in keyof PdfiumFunctions<Api>]: Mock<
    Extract<PdfiumFunctions<Api>[K], (...args: never[]) => unknown>
  >;
} & {
  pdfium: FakeRuntime;
};

/** A mocked core API. */
export type MockedPdfiumCore = MockedApi<PdfiumCoreApi>;

/**
 * Harmless default implementations of the core functions: handles from
 * `nextHandle`, booleans true, counts 1 page and 0 objects.
 *
 * @param nextHandle Gives a new handle number per call (shared with any
 *   extra defaults so handles stay unique within one fake).
 * @returns One implementation per core function.
 */
export function coreDefaults(nextHandle: () => number): {
  [
    K in keyof PdfiumFunctions<PdfiumCoreApi>
  ]: PdfiumFunctions<PdfiumCoreApi>[K];
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
 * A handle counter: 101, 102, ...
 *
 * @returns The counter function.
 */
export function handleCounter(): () => number {
  let handle = 100;
  return () => ++handle;
}

/**
 * Wrap default implementations in `vi.fn` mocks next to a fake runtime.
 * Override per test with `mockReturnValue` / `mockImplementation`; the
 * mocks carry the real signatures, so overrides are type-checked.
 *
 * @param defaults One implementation per function.
 * @param runtime The fake memory.
 * @returns The mocked API.
 */
export function mockApi<Api>(
  defaults: PdfiumFunctions<Api>,
  runtime: FakeRuntime,
): MockedApi<Api> {
  const mocks = Object.fromEntries(
    Object.entries(
      defaults as Record<string, (...args: never[]) => unknown>,
    ).map(([name, impl]) => [name, vi.fn(impl)]),
  );
  return { ...mocks, pdfium: runtime } as MockedApi<Api>;
}

/**
 * A mocked core PDFium API (see {@link coreDefaults}).
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakePdfiumCore(runtime = new FakeRuntime()): {
  api: MockedPdfiumCore;
  runtime: FakeRuntime;
} {
  return {
    api: mockApi<PdfiumCoreApi>(coreDefaults(handleCounter()), runtime),
    runtime,
  };
}
