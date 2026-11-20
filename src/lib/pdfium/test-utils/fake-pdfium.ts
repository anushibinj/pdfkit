/**
 * Test doubles for the PDFium module. Unit tests use them to check call
 * order and clean-up; real behaviour is covered by integration tests, which
 * run the actual WebAssembly build.
 *
 * Tools whose interface extends `PdfiumCoreApi` build their own fake from
 * {@link coreDefaults} plus their extra functions, with {@link mockApi}.
 */
import { vi, type Mock } from "vitest";
import type { PdfiumCoreApi, PdfiumRuntime } from "../core-api";

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

/**
 * Any function. The same shape as the constraint of vitest's `Mock` (which
 * vitest declares but does not export), so it needs the same `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Procedure = (...args: any[]) => any;

/** The functions of a PDFium interface, without the runtime. */
export type PdfiumFunctions<Api extends PdfiumCoreApi> = Omit<Api, "pdfium">;

/** Each PDFium function as a typed `vi.fn` mock, plus the fake runtime. */
export type MockedApi<Api extends PdfiumCoreApi> = {
  // `infer F extends Procedure` tells TypeScript each member is a function,
  // which a generic `Api` cannot prove on its own.
  [
    K in keyof PdfiumFunctions<Api>
  ]: PdfiumFunctions<Api>[K] extends infer F extends Procedure
    ? Mock<F>
    : never;
} & {
  pdfium: FakeRuntime;
};

/**
 * Make handle numbers for fakes: 101, 102, ... (never 0, which PDFium uses
 * for "failed").
 *
 * @param start The value before the first handle.
 * @returns A function returning the next handle on each call.
 */
export function handleCounter(start = 100): () => number {
  let handle = start;
  return () => ++handle;
}

/**
 * Harmless success values for every core function: handles from
 * `nextHandle`, booleans true, one page, empty buffers.
 *
 * @param nextHandle Source of handle numbers (share it with a tool's own
 *   defaults so handles stay unique).
 * @returns One implementation per core function.
 */
export function coreDefaults(
  nextHandle: () => number,
): PdfiumFunctions<PdfiumCoreApi> {
  const ok = () => true;
  const none = () => {};
  return {
    FPDF_GetLastError: () => 0,
    FPDF_LoadMemDocument: nextHandle,
    FPDF_CreateNewDocument: nextHandle,
    FPDF_CloseDocument: none,
    FPDF_GetPageCount: () => 1,
    FPDF_LoadPage: nextHandle,
    FPDF_ClosePage: none,
    FPDF_GetPageBoundingBox: ok,
    FPDFPage_GetRotation: () => 0,
    FPDF_RenderPageBitmap: none,
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
 * Wrap every default implementation in a `vi.fn` and attach the runtime.
 * The mocks carry the real signatures, so per-test overrides with
 * `mockReturnValue` / `mockImplementation` are type-checked.
 *
 * @param defaults One implementation per function of the interface.
 * @param runtime The fake memory to use.
 * @returns The mocked API.
 */
export function mockApi<Api extends PdfiumCoreApi>(
  defaults: PdfiumFunctions<Api>,
  runtime: FakeRuntime,
): MockedApi<Api> {
  const mocks = Object.fromEntries(
    Object.entries(defaults).map(([name, impl]) => [
      name,
      vi.fn(impl as (...args: unknown[]) => unknown),
    ]),
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
  api: MockedApi<PdfiumCoreApi>;
  runtime: FakeRuntime;
} {
  return { api: mockApi(coreDefaults(handleCounter()), runtime), runtime };
}
