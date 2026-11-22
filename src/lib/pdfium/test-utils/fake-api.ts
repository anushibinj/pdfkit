/**
 * Building blocks for faking a PDFium API slice in unit tests. Each tool
 * combines the shared defaults below with defaults for its own functions and
 * turns them into typed `vi.fn` mocks with {@link mockFunctions}.
 */
import { vi, type Mock } from "vitest";
import type { PdfiumDocumentApi } from "../document";
import type { PdfiumSaveApi } from "../save";
import { FakeRuntime } from "./fake-runtime";

/** The functions of an API slice, without its `pdfium` runtime. */
export type ApiFunctions<Api> = Omit<Api, "pdfium">;

/** Each function of `Functions` as a typed `vi.fn` mock. */
export type MockedFunctions<Functions> = {
  [K in keyof Functions]: Functions[K] extends (...args: never[]) => unknown
    ? Mock<Functions[K]>
    : never;
};

/** A mocked API slice: every function a `vi.fn`, on a fake runtime. */
export type MockedApi<Api> = MockedFunctions<ApiFunctions<Api>> & {
  pdfium: FakeRuntime;
};

/**
 * Make a source of fake handles: 101, 102, ... Real PDFium handles are
 * non-zero addresses, and 0 means failure, so counting from 101 keeps every
 * fake handle "successful" and distinct.
 *
 * @returns A function returning the next handle on each call.
 */
export function handleCounter(): () => number {
  let handle = 100;
  return () => ++handle;
}

/**
 * Harmless success values for every function of `PdfiumDocumentApi`: new
 * handles for loads and bitmaps, `true` for boolean calls, one page.
 *
 * @param nextHandle Source of fake handles (share one per fake module).
 * @returns The default implementations.
 */
export function documentDefaults(
  nextHandle: () => number,
): ApiFunctions<PdfiumDocumentApi> {
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
    FPDFPage_GetRotation: () => 0,
    FPDF_RenderPageBitmap: none,
    FPDFBitmap_Create: nextHandle,
    FPDFBitmap_FillRect: ok,
    FPDFBitmap_GetBuffer: () => 0,
    FPDFBitmap_GetStride: () => 0,
    FPDFBitmap_Destroy: none,
  };
}

/**
 * Harmless success values for every function of `PdfiumSaveApi`: a writer
 * handle, a successful save of zero bytes.
 *
 * @param nextHandle Source of fake handles (share one per fake module).
 * @returns The default implementations.
 */
export function saveDefaults(
  nextHandle: () => number,
): ApiFunctions<PdfiumSaveApi> {
  return {
    PDFiumExt_OpenFileWriter: nextHandle,
    PDFiumExt_SaveAsCopy: () => 1,
    PDFiumExt_GetFileWriterSize: () => 0,
    PDFiumExt_GetFileWriterData: () => 0,
    PDFiumExt_CloseFileWriter: () => {},
  };
}

/**
 * Wrap every default implementation in a `vi.fn`, keeping its signature, so
 * tests can override one with `mockReturnValue` / `mockImplementation` and
 * the override is type-checked against the real C signature.
 *
 * @param defaults One implementation per function name.
 * @returns The same names, each a mock calling its default.
 */
export function mockFunctions<Functions extends object>(
  defaults: Functions,
): MockedFunctions<Functions> {
  // `Object.fromEntries` returns a plain string-keyed record, which has lost
  // the per-name signatures; the cast restores them (each entry is built
  // from the default with the same name, so the types do line up).
  return Object.fromEntries(
    Object.entries(defaults).map(([name, impl]) => [
      name,
      vi.fn(impl as (...args: unknown[]) => unknown),
    ]),
  ) as unknown as MockedFunctions<Functions>;
}

/**
 * A mocked `PdfiumDocumentApi & PdfiumSaveApi` on a fake runtime, for tests
 * of the shared document and save code.
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakeDocumentPdfium(runtime = new FakeRuntime()): {
  api: MockedApi<PdfiumDocumentApi & PdfiumSaveApi>;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const mocks = mockFunctions<ApiFunctions<PdfiumDocumentApi & PdfiumSaveApi>>({
    ...documentDefaults(nextHandle),
    ...saveDefaults(nextHandle),
  });
  return { api: { ...mocks, pdfium: runtime }, runtime };
}
