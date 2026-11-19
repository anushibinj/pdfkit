/**
 * Test doubles for the PDFium module. Unit tests use them to check call
 * order and clean-up; real behaviour is covered by the integration tests,
 * which run the actual WebAssembly build.
 */
import { vi, type Mock } from "vitest";
import type { PdfiumApi, PdfiumRuntime } from "../engine/pdfium-api";

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

  setValue = (ptr: number, value: number) => {
    this.floats.set(ptr, value);
  };

  getValue = (ptr: number) => this.floats.get(ptr) ?? 0;

  /** @returns Allocations that were never freed. */
  leaks(): number[] {
    return this.allocated.filter((p) => !this.freed.includes(p));
  }
}

/** The PDFium functions, without the runtime. */
type PdfiumFunctions = Omit<PdfiumApi, "pdfium">;

/** Each PDFium function as a typed `vi.fn` mock. */
export type MockedPdfium = {
  [K in keyof PdfiumFunctions]: Mock<PdfiumFunctions[K]>;
} & {
  pdfium: FakeRuntime;
};

/**
 * A PDFium API where every function is a `vi.fn` returning a harmless
 * success value (handles are 101, 102, ...; booleans true). Override per
 * test with `mockReturnValue` / `mockImplementation`; the mocks carry the
 * real signatures, so implementations are type-checked.
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakePdfium(runtime = new FakeRuntime()): {
  api: MockedPdfium;
  runtime: FakeRuntime;
} {
  let handle = 100;
  const nextHandle = () => ++handle;
  const ok = () => true;
  const none = () => {};
  const defaults: { [K in keyof PdfiumFunctions]: PdfiumFunctions[K] } = {
    FPDF_GetLastError: () => 0,
    FPDF_LoadMemDocument: nextHandle,
    FPDF_CloseDocument: none,
    FPDF_GetPageCount: () => 1,
    FPDF_LoadPage: nextHandle,
    FPDF_ClosePage: none,
    FPDF_GetPageBoundingBox: ok,
    FPDF_MovePages: ok,
    FPDF_RenderPageBitmap: none,
    FPDFPage_GetRotation: () => 0,
    FPDFPage_SetRotation: none,
    FPDFPage_GenerateContent: ok,
    FPDFPage_InsertObject: none,
    FPDFPage_Delete: none,
    FPDFBitmap_Create: nextHandle,
    FPDFBitmap_FillRect: ok,
    FPDFBitmap_GetBuffer: () => 0,
    FPDFBitmap_GetStride: () => 0,
    FPDFBitmap_Destroy: none,
    FPDFPageObj_NewTextObj: nextHandle,
    FPDFText_SetText: ok,
    FPDFPageObj_CreateNewPath: nextHandle,
    FPDFPageObj_CreateNewRect: nextHandle,
    FPDFPath_LineTo: ok,
    FPDFPath_SetDrawMode: ok,
    FPDFPageObj_NewImageObj: nextHandle,
    EPDFImageObj_SetPng: ok,
    EPDFImageObj_SetJpeg: ok,
    FPDFPageObj_SetFillColor: ok,
    FPDFPageObj_SetStrokeColor: ok,
    FPDFPageObj_SetStrokeWidth: ok,
    FPDFPageObj_SetLineCap: ok,
    FPDFPageObj_SetLineJoin: ok,
    FPDFPageObj_SetBlendMode: none,
    FPDFPageObj_Transform: none,
    FPDFPageObj_Destroy: none,
    EPDFText_RedactInRect: ok,
    PDFiumExt_OpenFileWriter: nextHandle,
    PDFiumExt_SaveAsCopy: () => 1,
    PDFiumExt_GetFileWriterSize: () => 0,
    PDFiumExt_GetFileWriterData: () => 0,
    PDFiumExt_CloseFileWriter: none,
  };
  const mocks = Object.fromEntries(
    Object.entries(defaults).map(([name, impl]) => [name, vi.fn(impl)]),
  );
  return { api: { ...mocks, pdfium: runtime } as MockedPdfium, runtime };
}
